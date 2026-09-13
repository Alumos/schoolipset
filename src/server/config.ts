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
}

const getNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return value;
};

export const loadConfig = (): AppConfig => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const apiPort = getNumber('API_PORT', 18080);
  const adminPort = getNumber('ADMIN_PORT', 18081);
  if (apiPort === adminPort) {
    throw new Error('API_PORT and ADMIN_PORT must be different');
  }

  const adminPassword = process.env.ADMIN_PASSWORD?.trim() || 'change-me-in-development';
  if (nodeEnv === 'production' && (adminPassword === 'change-me-in-development' || adminPassword.length < 8)) {
    throw new Error('ADMIN_PASSWORD must be changed in production');
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
  };
};
