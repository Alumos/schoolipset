import crypto from 'node:crypto';
import XLSX from 'xlsx';
import { withTransaction, type Db } from './db.js';
import {
  isBlankRow,
  isIPv4,
  normalizeDisplayName,
  normalizeDns,
  normalizeNameKey,
  nowIso,
  parsePrefix,
  sameSubnet,
  sha256,
  toBoolean,
} from './utils.js';

export interface ImportRow {
  sourceRow: number;
  name: string;
  nameKey: string;
  ip: string;
  prefix: number;
  gateway: string;
  dns: string[];
  location: string | null;
  interfaceHint: string | null;
  enabled: boolean;
  errors: string[];
  warnings: string[];
  valid: boolean;
}

export interface ImportPreview {
  id: string;
  fileSha256: string;
  originalFilename: string;
  headers: string[];
  rows: ImportRow[];
  fullSync: boolean;
  createdAt: string;
}

const compactHeader = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .replace(/[\s:：_\-]/g, '')
    .toLocaleLowerCase('zh-CN');

const headerAliases = {
  name: ['教师姓名', '教职工', '姓名', '教师', '名字'],
  ip: ['ip', 'ip地址', 'ipv4', 'ipv4地址'],
  prefix: ['前缀长度', '前缀', '子网掩码', '掩码', '子网'],
  gateway: ['网关', '默认网关'],
  dns: ['dns', 'dns服务器', '域名服务器'],
  location: ['地点', '位置', '楼栋', '办公地点'],
  interfaceHint: ['网卡提示', '网卡', '接口', '网络接口'],
  enabled: ['启用', '是否启用', '状态'],
} as const;

type Field = keyof typeof headerAliases;

const findColumn = (headers: string[], field: Field): number => {
  const aliases = new Set(headerAliases[field].map(compactHeader));
  return headers.findIndex((header) => aliases.has(compactHeader(header)));
};

const text = (row: unknown[], index: number): string => String(row[index] ?? '').trim();

const parseIpAndPrefix = (rawIp: string, rawPrefix: string): { ip: string; prefix: number | null } => {
  const [ipPart, cidrPrefix] = rawIp.split('/');
  const ip = (ipPart ?? '').trim();
  const prefix = parsePrefix(cidrPrefix ?? rawPrefix);
  return { ip, prefix };
};

const isComplete = (row: ImportRow): boolean => row.errors.length === 0;

export const parseXlsx = (buffer: Buffer, originalFilename: string): ImportPreview => {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('XLSX 中没有工作表');
  const sheet = workbook.Sheets[firstSheet];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
  const headerIndex = matrix.findIndex((row) => {
    const headers = row.map(compactHeader);
    return findColumn(headers, 'name') >= 0 && findColumn(headers, 'ip') >= 0;
  });
  if (headerIndex < 0) {
    throw new Error('未找到表头。支持字段：教职工/教师姓名、IP地址、子网掩码、网关、DNS、地点');
  }

  const rawHeaders = (matrix[headerIndex] ?? []).map((value) => String(value ?? '').trim());
  const headers = rawHeaders.map(compactHeader);
  const columns = {
    name: findColumn(headers, 'name'),
    ip: findColumn(headers, 'ip'),
    prefix: findColumn(headers, 'prefix'),
    gateway: findColumn(headers, 'gateway'),
    dns: findColumn(headers, 'dns'),
    location: findColumn(headers, 'location'),
    interfaceHint: findColumn(headers, 'interfaceHint'),
    enabled: findColumn(headers, 'enabled'),
  };
  const rows: ImportRow[] = [];
  const seenNames = new Map<string, number>();
  const seenIps = new Map<string, number>();

  for (let matrixIndex = headerIndex + 1; matrixIndex < matrix.length; matrixIndex += 1) {
    const raw = matrix[matrixIndex] ?? [];
    if (isBlankRow(raw)) continue;
    const sourceRow = matrixIndex + 1;
    const name = normalizeDisplayName(text(raw, columns.name));
    const nameKey = normalizeNameKey(name);
    const rawIp = text(raw, columns.ip);
    const { ip, prefix } = parseIpAndPrefix(rawIp, text(raw, columns.prefix));
    const gateway = text(raw, columns.gateway);
    const dns = normalizeDns(text(raw, columns.dns));
    const location = text(raw, columns.location) || null;
    const interfaceHint = text(raw, columns.interfaceHint) || null;
    const enabled = toBoolean(text(raw, columns.enabled), true);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!name) errors.push('教师姓名为空');
    if (!isIPv4(ip)) errors.push('IP 地址不是合法 IPv4');
    if (prefix === null) errors.push('子网掩码/前缀长度不合法');
    if (!isIPv4(gateway)) errors.push('网关不是合法 IPv4');
    if (!dns.length || dns.some((server) => !isIPv4(server))) errors.push('DNS 必须为至少一个合法 IPv4');
    if (prefix !== null && isIPv4(ip) && isIPv4(gateway) && !sameSubnet(ip, gateway, prefix)) {
      errors.push('网关不在 IP 所属网段');
    }
    if (isIPv4(ip) && isIPv4(gateway) && ip === gateway) errors.push('IP 不能与网关相同');
    if (nameKey && seenNames.has(nameKey)) {
      errors.push(`姓名与第 ${seenNames.get(nameKey)} 行重复`);
    } else if (nameKey) {
      seenNames.set(nameKey, sourceRow);
    }
    if (ip && seenIps.has(ip)) {
      errors.push(`IP 与第 ${seenIps.get(ip)} 行重复`);
    } else if (ip) {
      seenIps.set(ip, sourceRow);
    }
    if (!location) warnings.push('未填写地点');
    if (!interfaceHint) warnings.push('未填写网卡提示，客户端将按网卡策略自动选择');

    rows.push({
      sourceRow,
      name,
      nameKey,
      ip,
      prefix: prefix ?? 0,
      gateway,
      dns,
      location,
      interfaceHint,
      enabled,
      errors,
      warnings,
      valid: isComplete({
        sourceRow,
        name,
        nameKey,
        ip,
        prefix: prefix ?? 0,
        gateway,
        dns,
        location,
        interfaceHint,
        enabled,
        errors,
        warnings,
        valid: false,
      }),
    });
  }

  return {
    id: crypto.randomUUID(),
    fileSha256: sha256(buffer),
    originalFilename,
    headers: rawHeaders,
    rows,
    fullSync: false,
    createdAt: nowIso(),
  };
};

export interface CommitResult {
  importId: number;
  inserted: number;
  updated: number;
  disabled: number;
  rows: number;
}

export const commitImport = (
  db: Db,
  preview: ImportPreview,
  fullSync: boolean,
  actor: string,
): CommitResult => {
  const validRows = preview.rows.filter((row) => row.valid);
  if (!validRows.length) throw new Error('没有可提交的有效数据');
  const timestamp = nowIso();
  let inserted = 0;
  let updated = 0;
  let disabled = 0;

  const result = withTransaction(db, () => {
    for (const row of validRows) {
      const existing = db
        .prepare('SELECT id FROM teachers WHERE name_key = ?')
        .get(row.nameKey) as { id: number } | undefined;
      let teacherId: number;
      if (existing) {
        teacherId = existing.id;
        db.prepare(
          'UPDATE teachers SET name = ?, enabled = ?, location = ?, updated_at = ? WHERE id = ?',
        ).run(row.name, row.enabled ? 1 : 0, row.location, timestamp, teacherId);
        updated += 1;
      } else {
        const result = db
          .prepare(
            'INSERT INTO teachers (name, name_key, enabled, location, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(row.name, row.nameKey, row.enabled ? 1 : 0, row.location, timestamp, timestamp);
        teacherId = Number(result.lastInsertRowid);
        inserted += 1;
      }
      const assignment = db.prepare('SELECT id FROM ip_assignments WHERE teacher_id = ?').get(teacherId) as
        | { id: number }
        | undefined;
      const dnsJson = JSON.stringify(row.dns);
      if (assignment) {
        db.prepare(
          `UPDATE ip_assignments
             SET interface_hint = ?, ip = ?, prefix = ?, gateway = ?, dns_json = ?, enabled = ?, updated_at = ?
           WHERE teacher_id = ?`,
        ).run(row.interfaceHint, row.ip, row.prefix, row.gateway, dnsJson, row.enabled ? 1 : 0, timestamp, teacherId);
      } else {
        db.prepare(
          `INSERT INTO ip_assignments
             (teacher_id, interface_hint, ip, prefix, gateway, dns_json, enabled, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(teacherId, row.interfaceHint, row.ip, row.prefix, row.gateway, dnsJson, row.enabled ? 1 : 0, timestamp);
      }
    }

    if (fullSync) {
      const names = validRows.map((row) => row.nameKey);
      const placeholders = names.map(() => '?').join(', ');
      const result = db
        .prepare(`UPDATE teachers SET enabled = 0, updated_at = ? WHERE name_key NOT IN (${placeholders}) AND enabled = 1`)
        .run(timestamp, ...names);
      disabled = Number(result.changes);
    }

    const result = db
      .prepare(
        `INSERT INTO import_batches
           (file_sha256, original_filename, imported_by, row_count, error_count, full_sync, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(preview.fileSha256, preview.originalFilename, actor, preview.rows.length, preview.rows.length - validRows.length, fullSync ? 1 : 0, timestamp);
    const importId = Number(result.lastInsertRowid);
    db.prepare(
      `INSERT INTO audit_logs (actor, action, object_type, object_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(actor, 'xlsx_import_commit', 'import_batch', String(importId), JSON.stringify({
      rows: preview.rows.length,
      validRows: validRows.length,
      fullSync,
      sha256: preview.fileSha256,
    }), timestamp);
    return { importId, inserted, updated, disabled, rows: validRows.length };
  });

  return result;
};
