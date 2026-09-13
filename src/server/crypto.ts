import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import type { AppConfig } from './config.js';

export interface ApplicationEnvelope {
  v: 1;
  keyId: string;
  oaep: 'sha256';
  encryptedKey: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

export interface DecryptedBody {
  payload: Record<string, unknown>;
  encrypted: boolean;
}

const asPem = (key: string): string => key.replace(/\\n/g, '\n');

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('payload must be a JSON object');
  }
  return value as Record<string, unknown>;
};

const base64Url = (value: Buffer): string => value.toString('base64url');

const publicKeyObject = (jwk: string | Record<string, unknown>): KeyObject => {
  const parsed = typeof jwk === 'string' ? JSON.parse(jwk) : jwk;
  return createPublicKey({ key: parsed, format: 'jwk' });
};

const hmacFor = (key: Buffer, envelope: Pick<ApplicationEnvelope, 'v' | 'keyId' | 'iv' | 'ciphertext'>): Buffer =>
  createHmac('sha256', key)
    .update(`${envelope.v}.${envelope.keyId}.${envelope.iv}.${envelope.ciphertext}`)
    .digest();

const safeBufferEqual = (left: Buffer, right: Buffer): boolean =>
  left.length === right.length && timingSafeEqual(left, right);

export const validatePublicJwk = (value: unknown): string => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  const key = publicKeyObject(parsed as Record<string, unknown>);
  const exported = key.export({ format: 'jwk' });
  return JSON.stringify(exported);
};

export const getServerPublicJwk = (config: AppConfig): string | null => {
  if (config.deviceServerPublicKey) {
    const value = config.deviceServerPublicKey.trim();
    if (value.startsWith('{')) return JSON.stringify(JSON.parse(value));
    const key = createPublicKey(asPem(value));
    return JSON.stringify(key.export({ format: 'jwk' }));
  }
  if (config.deviceServerPrivateKey) {
    const key = createPublicKey(asPem(config.deviceServerPrivateKey));
    return JSON.stringify(key.export({ format: 'jwk' }));
  }
  return null;
};

export const encryptForPublicKey = (
  payload: Record<string, unknown>,
  publicJwk: string,
  keyId: string,
): ApplicationEnvelope => {
  const aesKey = randomBytes(32);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: ApplicationEnvelope = {
    v: 1,
    keyId,
    oaep: 'sha256',
    encryptedKey: publicEncrypt(
      { key: publicKeyObject(publicJwk), oaepHash: 'sha256' },
      aesKey,
    ).toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: '',
  };
  envelope.tag = hmacFor(aesKey, envelope).toString('base64');
  return envelope;
};

export const decryptEnvelope = (envelopeValue: unknown, privateKey: string): Record<string, unknown> => {
  const envelope = asObject(envelopeValue) as unknown as Partial<ApplicationEnvelope>;
  if (envelope.v !== 1 || envelope.oaep !== 'sha256') throw new Error('unsupported encrypted payload version');
  for (const field of ['keyId', 'encryptedKey', 'iv', 'ciphertext', 'tag']) {
    if (typeof envelope[field as keyof ApplicationEnvelope] !== 'string') {
      throw new Error(`encrypted payload missing ${field}`);
    }
  }
  const aesKey = privateDecrypt(
    { key: asPem(privateKey), oaepHash: 'sha256' },
    Buffer.from(envelope.encryptedKey as string, 'base64'),
  );
  const expectedTag = hmacFor(aesKey, envelope as Pick<ApplicationEnvelope, 'v' | 'keyId' | 'iv' | 'ciphertext'>);
  const actualTag = Buffer.from(envelope.tag as string, 'base64');
  if (!safeBufferEqual(expectedTag, actualTag)) throw new Error('encrypted payload authentication failed');
  const decipher = createDecipheriv(
    'aes-256-cbc',
    aesKey,
    Buffer.from(envelope.iv as string, 'base64'),
  );
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext as string, 'base64')),
    decipher.final(),
  ]);
  return asObject(JSON.parse(plaintext.toString('utf8')));
};

export const decryptRequestBody = (body: unknown, config: AppConfig): DecryptedBody => {
  const root = asObject(body);
  if (root.envelope !== undefined) {
    if (!config.deviceServerPrivateKey) throw new Error('server application decryption key is not configured');
    return { payload: decryptEnvelope(root.envelope, config.deviceServerPrivateKey), encrypted: true };
  }
  if (config.clientCryptoRequired) throw new Error('encrypted client payload required');
  return { payload: root, encrypted: false };
};

export const responseBody = (
  payload: Record<string, unknown>,
  clientPublicKey: string | null | undefined,
  config: AppConfig,
): Record<string, unknown> => {
  if (!clientPublicKey) return payload;
  try {
    return {
      envelope: encryptForPublicKey(payload, clientPublicKey, config.deviceServerKeyId),
    };
  } catch {
    return payload;
  }
};

export const hashOpaqueToken = (token: string): string => createHash('sha256').update(token).digest('hex');
