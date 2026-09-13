import path from 'node:path';

export interface AppConfig {
  nodeEnv: string;
  apiHost: string;
  apiPort: number;
  adminHost: string;
  adminPort: number;
  dbPath: string;
  adminPassword: string;
  adminOrigins: string[];
  macHashSecret: string;
  clientCryptoRequired: boolean;
  deviceServerPrivateKey: string | undefined;
  deviceServerPublicKey: string | undefined;
  deviceServerKeyId: string;
}

const getNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return value;
};

const getBoolean = (name: string, fallback: boolean): boolean => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export const loadConfig = (): AppConfig => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const apiPort = getNumber('API_PORT', 18080);
  const adminPort = getNumber('ADMIN_PORT', 18081);
  if (apiPort === adminPort) {
    throw new Error('API_PORT and ADMIN_PORT must be different');
  }

  const adminPassword = process.env.ADMIN_PASSWORD ?? 'change-me-in-development';
  const macHashSecret = process.env.MAC_HASH_SECRET ?? 'local-development-only-mac-secret';
  const clientCryptoRequired = getBoolean('CLIENT_CRYPTO_REQUIRED', false);
  if (nodeEnv === 'production' && adminPassword === 'change-me-in-development') {
    throw new Error('ADMIN_PASSWORD must be changed in production');
  }
  if (nodeEnv === 'production' && macHashSecret === 'local-development-only-mac-secret') {
    throw new Error('MAC_HASH_SECRET must be changed in production');
  }
  if (nodeEnv === 'production' && clientCryptoRequired && !process.env.DEVICE_SERVER_PRIVATE_KEY) {
    throw new Error('DEVICE_SERVER_PRIVATE_KEY is required when CLIENT_CRYPTO_REQUIRED=true');
  }

  return {
    nodeEnv,
    apiHost: process.env.API_HOST ?? '0.0.0.0',
    apiPort,
    adminHost: process.env.ADMIN_HOST ?? '0.0.0.0',
    adminPort,
    dbPath: path.resolve(process.env.DB_PATH ?? './data/schoolipset.sqlite'),
    adminPassword,
    adminOrigins: (process.env.ADMIN_ORIGINS ?? 'http://127.0.0.1:18081,http://localhost:18081')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    macHashSecret,
    clientCryptoRequired,
    deviceServerPrivateKey: process.env.DEVICE_SERVER_PRIVATE_KEY,
    deviceServerPublicKey: process.env.DEVICE_SERVER_PUBLIC_KEY,
    deviceServerKeyId: process.env.DEVICE_SERVER_KEY_ID ?? 'default',
  };
};
