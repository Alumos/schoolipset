import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { constantTimeEqual } from './utils.js';

interface Session {
  expiresAt: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export const loginAdmin = (password: string, expectedPassword: string): string | null => {
  if (!constantTimeEqual(password, expectedPassword)) return null;
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
};

export const isAdminAuthenticated = (request: FastifyRequest): boolean => {
  const header = request.headers.authorization ?? '';
  const queryToken = typeof (request.query as { token?: unknown })?.token === 'string'
    ? String((request.query as { token: string }).token)
    : '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : queryToken;
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
};

export const requireAdmin = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  if (!isAdminAuthenticated(request)) {
    await reply.code(401).send({ error: 'unauthorized', message: '管理员登录已失效' });
  }
};

export const clearExpiredSessions = (): void => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(token);
  }
};
