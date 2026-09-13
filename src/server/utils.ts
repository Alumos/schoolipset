import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import net from 'node:net';

export const nowIso = (): string => new Date().toISOString();

export const normalizeDisplayName = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ');

export const normalizeNameKey = (value: string): string =>
  normalizeDisplayName(value).replace(/\s+/g, '').toLocaleLowerCase('zh-CN');

export const isBlankRow = (row: unknown[]): boolean =>
  row.every((value) => String(value ?? '').trim() === '');

export const isIPv4 = (value: string): boolean => net.isIP(value.trim()) === 4;

export const prefixFromMask = (mask: string): number | null => {
  const parts = mask.trim().split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  let sawZero = false;
  let prefix = 0;
  for (const octet of octets) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      const isOne = ((octet >> bit) & 1) === 1;
      if (isOne && sawZero) return null;
      if (isOne) prefix += 1;
      else sawZero = true;
    }
  }
  return prefix;
};

export const parsePrefix = (value: string): number | null => {
  const text = value.trim().replace(/^\//, '');
  if (/^\d+$/.test(text)) {
    const prefix = Number(text);
    return prefix >= 0 && prefix <= 32 ? prefix : null;
  }
  return prefixFromMask(text);
};

const ipv4ToInteger = (value: string): number =>
  value
    .trim()
    .split('.')
    .map(Number)
    .reduce((accumulator, octet) => ((accumulator << 8) | octet) >>> 0, 0);

export const sameSubnet = (ip: string, otherIp: string, prefix: number): boolean => {
  if (!isIPv4(ip) || !isIPv4(otherIp) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInteger(ip) & mask) === (ipv4ToInteger(otherIp) & mask);
};

export const normalizeDns = (value: string): string[] =>
  value
    .split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const normalizeMac = (value: string): string | null => {
  const compact = value.trim().replace(/[.:-]/g, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(compact) ? compact : null;
};

export const hashMac = (mac: string, secret: string): string =>
  createHmac('sha256', secret).update(mac).digest('hex');

export const hashOpaqueToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

export const constantTimeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const parseJsonArray = (value: string | null | undefined): string[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export const toBoolean = (value: unknown, fallback = true): boolean => {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', '否', '禁用', '停用'].includes(String(value).trim().toLowerCase());
};
