import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { loadConfig, type AppConfig } from './config.js';
import { openDatabase, type Db } from './db.js';
import {
  decryptRequestBody,
  getServerPublicJwk,
  hashOpaqueToken,
  responseBody,
  validatePublicJwk,
} from './crypto.js';
import { loginAdmin, requireAdmin, clearExpiredSessions } from './auth.js';
import { commitImport, parseXlsx, type ImportPreview } from './importer.js';
import {
  hashMac,
  isIPv4,
  normalizeDns,
  normalizeMac,
  normalizeNameKey,
  nowIso,
  parseJsonArray,
  constantTimeEqual,
} from './utils.js';

const registerSchema = z.object({
  name: z.string().min(1).max(80),
  deviceKey: z.string().min(8).max(160),
  publicKey: z.string().optional(),
  hostname: z.string().max(160).optional(),
  clientVersion: z.string().max(40).optional(),
});

const heartbeatSchema = z.object({
  deviceKey: z.string().min(8).max(160),
  token: z.string().min(20).max(300),
  hostname: z.string().max(160).optional(),
  clientVersion: z.string().max(40).optional(),
  mac: z.string().max(40).optional(),
  interfaceName: z.string().max(160).optional(),
  ip: z.string().max(64).optional(),
  prefix: z.number().int().min(0).max(32).optional(),
  gateway: z.string().max(64).optional(),
  dns: z.array(z.string().max(64)).max(6).optional(),
  idempotencyKey: z.string().min(8).max(160),
  source: z.string().max(40).optional(),
  clientStatus: z
    .enum(['normal', 'user_accepted_change', 'change_failed_suspected_conflict', 'rollback_failed'])
    .optional(),
  verification: z.record(z.unknown()).optional(),
});

const changeRequestSchema = z.object({
  deviceKey: z.string().min(8).max(160),
  token: z.string().min(20).max(300),
  idempotencyKey: z.string().min(8).max(160),
});

const changeResultSchema = z.object({
  deviceKey: z.string().min(8).max(160),
  token: z.string().min(20).max(300),
  changeToken: z.string().min(20).max(300),
  status: z.enum([
    'success',
    'user_declined',
    'verification_failed_rolled_back',
    'suspected_ip_conflict',
    'rollback_failed',
  ]),
  previousConfig: z.record(z.unknown()).optional(),
  finalConfig: z.record(z.unknown()).optional(),
  verification: z.record(z.unknown()).optional(),
});

type DeviceRow = {
  id: number;
  teacher_id: number;
  device_key: string;
  public_key: string | null;
  token_hash: string | null;
  name: string;
  enabled: number;
};

type AssignmentRow = {
  id: number;
  teacher_id: number;
  interface_hint: string | null;
  ip: string;
  prefix: number;
  gateway: string;
  dns_json: string;
  enabled: number;
  updated_at: string;
};

type SseClient = { response: FastifyReply['raw']; heartbeat: NodeJS.Timeout };

const previews = new Map<string, ImportPreview>();
const sseClients = new Set<SseClient>();

const sendError = (reply: FastifyReply, statusCode: number, message: string, detail?: unknown): void => {
  reply.code(statusCode).send({ error: 'request_failed', message, ...(detail ? { detail } : {}) });
};

const publicAssignment = (assignment: AssignmentRow | undefined): Record<string, unknown> | null => {
  if (!assignment) return null;
  return {
    ip: assignment.ip,
    prefix: assignment.prefix,
    gateway: assignment.gateway,
    dns: parseJsonArray(assignment.dns_json),
    interfaceHint: assignment.interface_hint,
    version: assignment.updated_at,
  };
};

const sameDns = (left: string[], right: string[]): boolean =>
  JSON.stringify([...left].map((value) => value.trim()).sort()) ===
  JSON.stringify([...right].map((value) => value.trim()).sort());

const matchesAssignment = (
  assignment: AssignmentRow | undefined,
  observed: { ip?: string; prefix?: number; gateway?: string; dns?: string[] },
): boolean => {
  if (!assignment || !assignment.enabled) return false;
  return (
    observed.ip === assignment.ip &&
    observed.prefix === assignment.prefix &&
    observed.gateway === assignment.gateway &&
    sameDns(observed.dns ?? [], parseJsonArray(assignment.dns_json))
  );
};

const statusLabel = (result: string | null, lastSeen: string | null, enabled: number): string => {
  if (!enabled) return 'disabled';
  if (!lastSeen || Date.now() - Date.parse(lastSeen) > 3 * 60 * 1000) return 'offline';
  return result ?? 'unknown';
};

const broadcast = (type: string, payload: Record<string, unknown>): void => {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.response.write(message);
    } catch {
      clearInterval(client.heartbeat);
      sseClients.delete(client);
    }
  }
};

const addAudit = (
  db: Db,
  actor: string,
  action: string,
  objectType: string,
  objectId: string | null,
  metadata: Record<string, unknown>,
): void => {
  db.prepare(
    `INSERT INTO audit_logs (actor, action, object_type, object_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(actor, action, objectType, objectId, JSON.stringify(metadata), nowIso());
};

const findDeviceByCredentials = (db: Db, deviceKey: string, token: string): DeviceRow | undefined =>
  db
    .prepare(
      `SELECT d.id, d.teacher_id, d.device_key, d.public_key, d.token_hash,
              t.name, t.enabled
         FROM devices d
         JOIN teachers t ON t.id = d.teacher_id
        WHERE d.device_key = ? AND d.token_hash = ? AND d.revoked_at IS NULL`,
    )
    .get(deviceKey, hashOpaqueToken(token)) as DeviceRow | undefined;

const findAssignment = (db: Db, teacherId: number): AssignmentRow | undefined =>
  db.prepare('SELECT * FROM ip_assignments WHERE teacher_id = ?').get(teacherId) as AssignmentRow | undefined;

const parseDeviceBody = (request: FastifyRequest, config: AppConfig): { payload: Record<string, unknown>; encrypted: boolean } => {
  try {
    return decryptRequestBody(request.body, config);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'invalid encrypted payload');
  }
};

const sendDevicePayload = (
  reply: FastifyReply,
  payload: Record<string, unknown>,
  publicKey: string | null | undefined,
  config: AppConfig,
): void => {
  reply.send(responseBody(payload, publicKey, config));
};

const registerRoutes = (app: FastifyInstance, db: Db, config: AppConfig): void => {
  app.get('/health', async () => ({ status: 'ok', service: 'schoolipset-api', now: nowIso() }));

  app.post('/v1/admin/login', async (request, reply) => {
    const password = typeof (request.body as { password?: unknown })?.password === 'string'
      ? (request.body as { password: string }).password
      : '';
    const token = loginAdmin(password, config.adminPassword);
    if (!token) return sendError(reply, 401, '管理员密码不正确');
    return reply.send({ token, expiresIn: 8 * 60 * 60 });
  });

  app.get('/v1/admin/overview', { preHandler: requireAdmin }, async (_request, reply) => {
    const total = (db.prepare('SELECT COUNT(*) AS count FROM teachers').get() as { count: number }).count;
    const enabled = (db.prepare('SELECT COUNT(*) AS count FROM teachers WHERE enabled = 1').get() as { count: number }).count;
    const online = (
      db
        .prepare("SELECT COUNT(*) AS count FROM devices WHERE revoked_at IS NULL AND julianday(last_seen) >= julianday('now', '-3 minutes')")
        .get() as { count: number }
    ).count;
    const bound = (
      db.prepare('SELECT COUNT(DISTINCT teacher_id) AS count FROM devices WHERE revoked_at IS NULL').get() as { count: number }
    ).count;
    const statusRows = db
      .prepare(
        `SELECT e.result, COUNT(*) AS count
           FROM check_events e
          WHERE e.id IN (SELECT MAX(id) FROM check_events GROUP BY teacher_id)
          GROUP BY e.result`,
      )
      .all() as Array<{ result: string; count: number }>;
    const statuses: Record<string, number> = Object.fromEntries(statusRows.map((row) => [row.result, row.count]));
    const compliant = statuses.compliant ?? 0;
    const actionRequired =
      (statuses.non_compliant ?? 0) +
      (statuses.non_compliant_refused ?? 0) +
      (statuses.change_failed_suspected_conflict ?? 0) +
      (statuses.rollback_failed ?? 0);
    const lastImport = db
      .prepare('SELECT * FROM import_batches ORDER BY id DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;
    return reply.send({
      generatedAt: nowIso(),
      total,
      enabled,
      online,
      compliant,
      actionRequired,
      unbound: Math.max(0, enabled - bound),
      statuses,
      lastImport: lastImport
        ? {
            filename: lastImport.original_filename,
            rows: lastImport.row_count,
            createdAt: lastImport.created_at,
          }
        : null,
    });
  });

  app.get('/v1/admin/teachers', { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as { q?: string; status?: string; page?: string; pageSize?: string };
    const q = String(query.q ?? '').trim();
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(query.pageSize ?? 50) || 50));
    const rows = db
      .prepare(
        `SELECT t.id, t.name, t.enabled, t.location, t.updated_at,
                a.ip, a.prefix, a.gateway, a.dns_json, a.interface_hint, a.enabled AS assignment_enabled,
                d.device_key, d.hostname, d.client_version, d.last_seen,
                e.result, e.reason, e.created_at AS event_created_at
           FROM teachers t
           LEFT JOIN ip_assignments a ON a.teacher_id = t.id
           LEFT JOIN devices d ON d.id = (
             SELECT id FROM devices d2 WHERE d2.teacher_id = t.id AND d2.revoked_at IS NULL ORDER BY last_seen DESC LIMIT 1
           )
           LEFT JOIN check_events e ON e.id = (
             SELECT id FROM check_events e2 WHERE e2.teacher_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1
           )
          WHERE (? = '' OR t.name LIKE '%' || ? || '%' OR t.location LIKE '%' || ? || '%')
          ORDER BY t.id ASC
          LIMIT ? OFFSET ?`,
      )
      .all(q, q, q, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
    const filtered = rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        enabled: Boolean(row.enabled),
        location: row.location,
        assignment: row.ip
          ? {
              ip: row.ip,
              prefix: row.prefix,
              gateway: row.gateway,
              dns: parseJsonArray(String(row.dns_json ?? '[]')),
              interfaceHint: row.interface_hint,
              enabled: Boolean(row.assignment_enabled),
            }
          : null,
        device: row.device_key
          ? {
              hostname: row.hostname,
              clientVersion: row.client_version,
              lastSeen: row.last_seen,
            }
          : null,
        status: statusLabel(row.result ? String(row.result) : null, row.last_seen ? String(row.last_seen) : null, Number(row.enabled)),
        lastReason: row.reason,
        lastEventAt: row.event_created_at,
      }))
      .filter((row) => !query.status || query.status === 'all' || row.status === query.status);
    const total = (
      db
        .prepare("SELECT COUNT(*) AS count FROM teachers WHERE (? = '' OR name LIKE '%' || ? || '%' OR location LIKE '%' || ? || '%')")
        .get(q, q, q) as { count: number }
    ).count;
    return reply.send({ data: filtered, page, pageSize, total });
  });

  app.get('/v1/admin/events', { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(200, Math.max(10, Number(query.limit ?? 50) || 50));
    const rows = db
      .prepare(
        `SELECT e.id, e.teacher_id, t.name, t.location, e.device_id, e.observed_ip, e.observed_prefix,
                e.observed_gateway, e.observed_dns_json, e.result, e.reason, e.source, e.created_at,
                d.hostname, d.client_version
           FROM check_events e
           JOIN teachers t ON t.id = e.teacher_id
           JOIN devices d ON d.id = e.device_id
          ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;
    return reply.send({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        location: row.location,
        observedIp: row.observed_ip,
        observedPrefix: row.observed_prefix,
        observedGateway: row.observed_gateway,
        observedDns: parseJsonArray(String(row.observed_dns_json ?? '[]')),
        result: row.result,
        reason: row.reason,
        source: row.source,
        createdAt: row.created_at,
        hostname: row.hostname,
        clientVersion: row.client_version,
      })),
    });
  });

  app.get('/v1/admin/audit-logs', { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(200, Math.max(10, Number(query.limit ?? 80) || 80));
    const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>;
    return reply.send({
      data: rows.map((row) => ({
        id: row.id,
        actor: row.actor,
        action: row.action,
        objectType: row.object_type,
        objectId: row.object_id,
        metadata: JSON.parse(String(row.metadata_json ?? '{}')),
        createdAt: row.created_at,
      })),
    });
  });

  app.post('/v1/admin/import/preview', { preHandler: requireAdmin }, async (request, reply) => {
    const file = await request.file();
    if (!file) return sendError(reply, 400, '请选择 XLSX 文件');
    if (!/\.xlsx?$/i.test(file.filename)) return sendError(reply, 400, '只支持 .xlsx 或 .xls 文件');
    try {
      const buffer = await file.toBuffer();
      if (buffer.length > 10 * 1024 * 1024) return sendError(reply, 413, '文件不能超过 10 MB');
      const preview = parseXlsx(buffer, file.filename);
      previews.set(preview.id, preview);
      setTimeout(() => previews.delete(preview.id), 15 * 60 * 1000).unref();
      const valid = preview.rows.filter((row) => row.valid).length;
      return reply.send({
        id: preview.id,
        filename: preview.originalFilename,
        fileSha256: preview.fileSha256,
        headers: preview.headers,
        totalRows: preview.rows.length,
        validRows: valid,
        errorRows: preview.rows.length - valid,
        warningRows: preview.rows.filter((row) => row.warnings.length).length,
        rows: preview.rows,
      });
    } catch (error) {
      return sendError(reply, 422, error instanceof Error ? error.message : 'XLSX 解析失败');
    }
  });

  app.post('/v1/admin/import/commit', { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as { previewId?: unknown; fullSync?: unknown };
    const previewId = typeof body?.previewId === 'string' ? body.previewId : '';
    const preview = previews.get(previewId);
    if (!preview) return sendError(reply, 404, '导入预览已过期，请重新上传');
    if (preview.rows.some((row) => !row.valid)) return sendError(reply, 422, '预览中仍有错误行，请修正后重新导入');
    try {
      const result = commitImport(db, preview, Boolean(body.fullSync), 'admin');
      previews.delete(previewId);
      broadcast('import_committed', { ...result, at: nowIso() });
      return reply.send(result);
    } catch (error) {
      return sendError(reply, 422, error instanceof Error ? error.message : '导入提交失败');
    }
  });

  app.post('/v1/admin/teachers/:id/revoke-devices', { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id < 1) return sendError(reply, 400, '教师 ID 不合法');
    const result = db.prepare("UPDATE devices SET revoked_at = ? WHERE teacher_id = ? AND revoked_at IS NULL").run(nowIso(), id);
    addAudit(db, 'admin', 'revoke_devices', 'teacher', String(id), { count: result.changes });
    broadcast('teacher_updated', { teacherId: id, at: nowIso() });
    return reply.send({ revoked: result.changes });
  });

  app.get('/v1/admin/stream', { preHandler: requireAdmin }, async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`);
    const client: SseClient = {
      response: reply.raw,
      heartbeat: setInterval(() => reply.raw.write(': ping\n\n'), 20_000),
    };
    sseClients.add(client);
    request.raw.on('close', () => {
      clearInterval(client.heartbeat);
      sseClients.delete(client);
    });
  });

  app.get('/v1/device/server-key', async (_request, reply) => {
    const publicKey = getServerPublicJwk(config);
    if (!publicKey) return sendError(reply, 503, '服务端设备加密公钥尚未配置');
    return reply.send({ keyId: config.deviceServerKeyId, publicKey: JSON.parse(publicKey), algorithm: 'RSA-OAEP-SHA256+AES-256-CBC-HMAC-SHA256' });
  });

  app.post('/v1/device/register', async (request, reply) => {
    try {
      const { payload } = parseDeviceBody(request, config);
      const parsed = registerSchema.parse(payload);
      const nameKey = normalizeNameKey(parsed.name);
      const teacher = db.prepare('SELECT id, name, enabled FROM teachers WHERE name_key = ?').get(nameKey) as
        | { id: number; name: string; enabled: number }
        | undefined;
      if (!teacher || !teacher.enabled) return sendError(reply, 404, '后台没有找到已启用的教师名单');
      let publicKey: string | null = null;
      if (parsed.publicKey) {
        try {
          publicKey = validatePublicJwk(parsed.publicKey);
        } catch {
          return sendError(reply, 422, '客户端公钥格式不正确');
        }
      }
      const existing = db
        .prepare('SELECT id, token_hash, public_key, revoked_at FROM devices WHERE teacher_id = ? AND device_key = ?')
        .get(teacher.id, parsed.deviceKey) as
        | { id: number; token_hash: string | null; public_key: string | null; revoked_at: string | null }
        | undefined;
      const otherActive = db
        .prepare('SELECT COUNT(*) AS count FROM devices WHERE teacher_id = ? AND device_key != ? AND revoked_at IS NULL')
        .get(teacher.id, parsed.deviceKey) as { count: number };
      if (!existing && otherActive.count > 0) {
        return sendError(reply, 409, '该教师已有绑定设备，请先由管理员撤销旧设备后再绑定');
      }
      const token = randomBytes(32).toString('base64url');
      const timestamp = nowIso();
      let deviceId: number;
      if (existing) {
        deviceId = existing.id;
        db.prepare(
          `UPDATE devices SET token_hash = ?, public_key = COALESCE(?, public_key), hostname = ?, client_version = ?,
                              last_seen = ?, revoked_at = NULL WHERE id = ?`,
        ).run(hashOpaqueToken(token), publicKey, parsed.hostname ?? null, parsed.clientVersion ?? null, timestamp, deviceId);
      } else {
        const result = db
          .prepare(
            `INSERT INTO devices (teacher_id, device_key, public_key, token_hash, hostname, client_version, first_seen, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(teacher.id, parsed.deviceKey, publicKey, hashOpaqueToken(token), parsed.hostname ?? null, parsed.clientVersion ?? null, timestamp, timestamp);
        deviceId = Number(result.lastInsertRowid);
      }
      addAudit(db, 'device', 'device_register', 'device', String(deviceId), { teacherId: teacher.id });
      const assignment = findAssignment(db, teacher.id);
      return sendDevicePayload(
        reply,
        {
          deviceId,
          token,
          teacher: { name: teacher.name },
          assignment: publicAssignment(assignment),
          serverTime: timestamp,
          policy: { heartbeatSeconds: 60, immediateOnNetworkChange: true },
        },
        publicKey,
        config,
      );
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : '设备注册请求不合法');
    }
  });

  app.post('/v1/heartbeat', async (request, reply) => {
    try {
      const { payload } = parseDeviceBody(request, config);
      const parsed = heartbeatSchema.parse(payload);
      const device = findDeviceByCredentials(db, parsed.deviceKey, parsed.token);
      if (!device || !device.enabled) return sendError(reply, 401, '设备令牌无效或教师已停用');
      const timestamp = nowIso();
      const mac = parsed.mac ? normalizeMac(parsed.mac) : null;
      const macHash = mac ? hashMac(mac, config.macHashSecret) : null;
      const dns = parsed.dns ?? [];
      const assignment = findAssignment(db, device.teacher_id);
      const validIp = !parsed.ip || isIPv4(parsed.ip);
      const validGateway = !parsed.gateway || isIPv4(parsed.gateway);
      const matches = validIp && validGateway && matchesAssignment(assignment, parsed);
      let result = matches ? 'compliant' : 'non_compliant';
      let reason = matches ? '配置与名单一致' : '当前网卡配置与后台名单不一致';
      if (parsed.clientStatus === 'user_accepted_change') {
        result = 'modifying';
        reason = '教师已接受一键修改，等待客户端回报验证结果';
      } else if (parsed.clientStatus === 'change_failed_suspected_conflict') {
        result = 'change_failed_suspected_conflict';
        reason = '目标 IP 修改后网络验证失败，客户端已回滚，疑似目标 IP 被占用';
      } else if (parsed.clientStatus === 'rollback_failed') {
        result = 'rollback_failed';
        reason = '目标配置失败且旧配置回滚失败，需要管理员介入';
      }
      db.prepare(
        `UPDATE devices SET hostname = COALESCE(?, hostname), mac_hash = COALESCE(?, mac_hash),
                            client_version = COALESCE(?, client_version), last_seen = ? WHERE id = ?`,
      ).run(parsed.hostname ?? null, macHash, parsed.clientVersion ?? null, timestamp, device.id);
      const existingEvent = db.prepare('SELECT * FROM check_events WHERE idempotency_key = ?').get(parsed.idempotencyKey) as
        | Record<string, unknown>
        | undefined;
      if (existingEvent) {
        return sendDevicePayload(
          reply,
          { accepted: true, duplicate: true, eventId: existingEvent.id, result: existingEvent.result, serverTime: timestamp },
          device.public_key,
          config,
        );
      }
      const event = db
        .prepare(
          `INSERT INTO check_events
             (teacher_id, device_id, observed_ip, observed_prefix, observed_gateway, observed_dns_json,
              observed_mac_hash, result, reason, source, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          device.teacher_id,
          device.id,
          parsed.ip ?? null,
          parsed.prefix ?? null,
          parsed.gateway ?? null,
          JSON.stringify(dns),
          macHash,
          result,
          reason,
          parsed.source ?? 'heartbeat',
          parsed.idempotencyKey,
          timestamp,
        );
      const eventId = Number(event.lastInsertRowid);
      broadcast('heartbeat', { eventId, teacherId: device.teacher_id, result, at: timestamp });
      return sendDevicePayload(reply, { accepted: true, eventId, result, reason, assignment: publicAssignment(assignment), serverTime: timestamp }, device.public_key, config);
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : '心跳请求不合法');
    }
  });

  app.get('/v1/device/policy', async (request, reply) => {
    try {
      const query = request.query as { deviceKey?: string; token?: string };
      const device = findDeviceByCredentials(db, String(query.deviceKey ?? ''), String(query.token ?? ''));
      if (!device || !device.enabled) return sendError(reply, 401, '设备令牌无效');
      const assignment = findAssignment(db, device.teacher_id);
      return sendDevicePayload(reply, { assignment: publicAssignment(assignment), policy: { heartbeatSeconds: 60, immediateOnNetworkChange: true } }, device.public_key, config);
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : '策略请求不合法');
    }
  });

  app.post('/v1/change-requests', async (request, reply) => {
    try {
      const { payload } = parseDeviceBody(request, config);
      const parsed = changeRequestSchema.parse(payload);
      const device = findDeviceByCredentials(db, parsed.deviceKey, parsed.token);
      if (!device || !device.enabled) return sendError(reply, 401, '设备令牌无效');
      const assignment = findAssignment(db, device.teacher_id);
      if (!assignment || !assignment.enabled) return sendError(reply, 409, '当前教师没有可下发的完整网络配置');
      const duplicate = db.prepare('SELECT * FROM change_requests WHERE target_config_json LIKE ?').get(`%${parsed.idempotencyKey}%`) as
        | Record<string, unknown>
        | undefined;
      if (duplicate) {
        return sendDevicePayload(reply, { requestId: duplicate.id, status: duplicate.status, assignment: publicAssignment(assignment) }, device.public_key, config);
      }
      const changeToken = randomBytes(32).toString('base64url');
      const timestamp = nowIso();
      const targetConfig = {
        ip: assignment.ip,
        prefix: assignment.prefix,
        gateway: assignment.gateway,
        dns: parseJsonArray(assignment.dns_json),
        interfaceHint: assignment.interface_hint,
        requestKey: parsed.idempotencyKey,
      };
      const result = db
        .prepare(
          `INSERT INTO change_requests (device_id, target_config_json, change_token_hash, status, verification_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(device.id, JSON.stringify(targetConfig), hashOpaqueToken(changeToken), 'accepted', JSON.stringify({ requestKey: parsed.idempotencyKey }), timestamp);
      const requestId = Number(result.lastInsertRowid);
      db.prepare('UPDATE check_events SET result = ?, reason = ? WHERE id = (SELECT id FROM check_events WHERE teacher_id = ? ORDER BY created_at DESC, id DESC LIMIT 1)')
        .run('modifying', '教师已接受一键修改，等待网络验证', device.teacher_id);
      broadcast('change_requested', { requestId, teacherId: device.teacher_id, at: timestamp });
      return sendDevicePayload(reply, { requestId, changeToken, status: 'accepted', assignment: publicAssignment(assignment), serverTime: timestamp }, device.public_key, config);
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : '修改请求不合法');
    }
  });

  app.post('/v1/change-requests/:id/result', async (request, reply) => {
    try {
      const { payload } = parseDeviceBody(request, config);
      const parsed = changeResultSchema.parse(payload);
      const requestId = Number((request.params as { id: string }).id);
      const device = findDeviceByCredentials(db, parsed.deviceKey, parsed.token);
      if (!device || !device.enabled) return sendError(reply, 401, '设备令牌无效');
      const changeRequest = db.prepare('SELECT * FROM change_requests WHERE id = ? AND device_id = ?').get(requestId, device.id) as
        | Record<string, unknown>
        | undefined;
      if (!changeRequest) return sendError(reply, 404, '修改请求不存在');
      if (changeRequest.change_token_hash && !constantTimeEqual(String(changeRequest.change_token_hash), hashOpaqueToken(parsed.changeToken))) {
        return sendError(reply, 403, '修改令牌无效');
      }
      const resultMap: Record<string, { result: string; reason: string }> = {
        success: { result: 'compliant', reason: '网络配置已修改并通过验证' },
        user_declined: { result: 'non_compliant_refused', reason: '教师选择不修改网络配置' },
        verification_failed_rolled_back: { result: 'change_failed', reason: '验证失败，已恢复原网络配置' },
        suspected_ip_conflict: { result: 'change_failed_suspected_conflict', reason: '修改后验证失败，已恢复原配置，疑似目标 IP 被占用' },
        rollback_failed: { result: 'rollback_failed', reason: '修改和回滚均失败，需要管理员介入' },
      };
      const mapped = resultMap[parsed.status];
      const timestamp = nowIso();
      db.prepare(
        `UPDATE change_requests SET status = ?, verification_json = ?, completed_at = ? WHERE id = ?`,
      ).run(parsed.status, JSON.stringify({ verification: parsed.verification, previousConfig: parsed.previousConfig, finalConfig: parsed.finalConfig }), timestamp, requestId);
      const idempotencyKey = `change-result:${requestId}:${parsed.status}`;
      const existingEvent = db.prepare('SELECT id, result, reason FROM check_events WHERE idempotency_key = ?').get(idempotencyKey) as
        | { id: number; result: string; reason: string }
        | undefined;
      if (existingEvent) {
        return sendDevicePayload(reply, { accepted: true, duplicate: true, eventId: existingEvent.id, result: existingEvent.result, reason: existingEvent.reason }, device.public_key, config);
      }
      const assignment = findAssignment(db, device.teacher_id);
      const heartbeat = db
        .prepare(
          `INSERT INTO check_events
             (teacher_id, device_id, observed_ip, observed_prefix, observed_gateway, observed_dns_json,
              result, reason, source, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          device.teacher_id,
          device.id,
          (parsed.finalConfig?.ip as string | undefined) ?? null,
          (parsed.finalConfig?.prefix as number | undefined) ?? null,
          (parsed.finalConfig?.gateway as string | undefined) ?? null,
          JSON.stringify((parsed.finalConfig?.dns as string[] | undefined) ?? []),
          mapped.result,
          mapped.reason,
          'change_result',
          idempotencyKey,
          timestamp,
        );
      broadcast('change_result', { requestId, teacherId: device.teacher_id, result: mapped.result, at: timestamp });
      return sendDevicePayload(reply, { accepted: true, eventId: Number(heartbeat.lastInsertRowid), result: mapped.result, reason: mapped.reason, assignment: publicAssignment(assignment) }, device.public_key, config);
    } catch (error) {
      return sendError(reply, 400, error instanceof Error ? error.message : '修改结果不合法');
    }
  });
};

const createApi = async (db: Db, config: AppConfig): Promise<FastifyInstance> => {
  const app = Fastify({ logger: true, bodyLimit: 512 * 1024 });
  await app.register(cors, { origin: config.adminOrigins, credentials: false });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, { global: true, max: 240, timeWindow: '1 minute' });
  registerRoutes(app, db, config);
  return app;
};

const createAdmin = async (config: AppConfig): Promise<FastifyInstance> => {
  const app = Fastify({ logger: true });
  const staticRoot = path.resolve(process.cwd(), 'dist/web');
  if (fs.existsSync(staticRoot)) {
    await app.register(fastifyStatic, { root: staticRoot, prefix: '/assets/', wildcard: false });
  }
  const serveIndex = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const index = path.join(staticRoot, 'index.html');
    if (!fs.existsSync(index)) {
      await reply.code(503).type('text/plain; charset=utf-8').send('后台前端尚未构建，请运行 npm run build');
      return;
    }
    await reply.type('text/html; charset=utf-8').sendFile('index.html');
  };
  app.get('/healthz', async () => ({ status: 'ok', service: 'schoolipset-admin', port: config.adminPort }));
  app.get('/', serveIndex);
  app.get('/*', serveIndex);
  return app;
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const api = await createApi(db, config);
  const admin = await createAdmin(config);
  await api.listen({ host: config.apiHost, port: config.apiPort });
  await admin.listen({ host: config.adminHost, port: config.adminPort });
  const cleanup = setInterval(clearExpiredSessions, 15 * 60 * 1000);
  cleanup.unref();
  const shutdown = async (signal: string): Promise<void> => {
    api.log.info({ signal }, 'shutting down');
    clearInterval(cleanup);
    for (const client of sseClients) {
      clearInterval(client.heartbeat);
      client.response.end();
    }
    await Promise.all([api.close(), admin.close()]);
    db.close();
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
