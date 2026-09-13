export interface Overview {
  total: number;
  enabled: number;
  online: number;
  compliant: number;
  actionRequired: number;
  unbound: number;
  statuses: Record<string, number>;
  generatedAt: string;
  lastImport: { filename: string; rows: number; createdAt: string } | null;
}

export interface Assignment {
  ip: string;
  prefix: number;
  gateway: string;
  dns: string[];
  interfaceHint: string | null;
  enabled?: boolean;
}

export interface Teacher {
  id: number;
  name: string;
  enabled: boolean;
  location: string | null;
  assignment: Assignment | null;
  device: { macAddress: string | null; hostname: string | null; clientVersion: string | null; lastSeen: string | null } | null;
  status: string;
  lastReason: string | null;
  lastEventAt: string | null;
}

export interface EventItem {
  id: number;
  name: string;
  location: string | null;
  observedIp: string | null;
  observedPrefix: number | null;
  observedGateway: string | null;
  observedDns: string[];
  macAddress: string | null;
  result: string;
  reason: string | null;
  source: string;
  createdAt: string;
  hostname: string | null;
  clientVersion: string | null;
}

export interface ImportRow {
  sourceRow: number;
  name: string;
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
  filename: string;
  fileSha256: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
  rows: ImportRow[];
}

const tokenKey = 'schoolipset.admin.token';

const apiBase = (): string => {
  if (import.meta.env.VITE_API_BASE) return String(import.meta.env.VITE_API_BASE).replace(/\/$/, '');
  if (window.location.port === '5173' || window.location.port === '') return '';
  return `${window.location.protocol}//${window.location.hostname}:18080`;
};

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const token = sessionStorage.getItem(tokenKey);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${apiBase()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as { message?: string } & T;
  if (!response.ok) throw new Error(payload.message ?? `请求失败 (${response.status})`);
  return payload;
};

export const api = {
  tokenKey,
  login: async (password: string): Promise<void> => {
    const result = await request<{ token: string }>('/v1/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    sessionStorage.setItem(tokenKey, result.token);
  },
  logout: (): void => sessionStorage.removeItem(tokenKey),
  overview: (): Promise<Overview> => request('/v1/admin/overview'),
  teachers: (params: { q?: string; status?: string }): Promise<{ data: Teacher[]; total: number }> => {
    const query = new URLSearchParams({ page: '1', pageSize: '200', ...(params.q ? { q: params.q } : {}), ...(params.status && params.status !== 'all' ? { status: params.status } : {}) });
    return request(`/v1/admin/teachers?${query.toString()}`);
  },
  events: (): Promise<{ data: EventItem[] }> => request('/v1/admin/events?limit=80'),
  clearEvents: (): Promise<{ deleted: number }> => request('/v1/admin/events', { method: 'DELETE' }),
  previewImport: (file: File): Promise<ImportPreview> => {
    const form = new FormData();
    form.append('file', file);
    return request('/v1/admin/import/preview', { method: 'POST', body: form });
  },
  commitImport: (previewId: string, fullSync: boolean): Promise<{ inserted: number; updated: number; disabled: number; rows: number }> =>
    request('/v1/admin/import/commit', { method: 'POST', body: JSON.stringify({ previewId, fullSync }) }),
  revokeDevices: (teacherId: number): Promise<{ revoked: number }> =>
    request(`/v1/admin/teachers/${teacherId}/revoke-devices`, { method: 'POST', body: JSON.stringify({}) }),
  updateTeacher: (teacherId: number, payload: {
    name: string;
    location: string | null;
    enabled: boolean;
    assignment: Assignment | null;
  }): Promise<{ updated: boolean; teacherId: number }> =>
    request(`/v1/admin/teachers/${teacherId}`, { method: 'PUT', body: JSON.stringify(payload) }),
};

export const openAdminStream = (onEvent: () => void): (() => void) => {
  const token = sessionStorage.getItem(tokenKey);
  if (!token) return () => undefined;
  const source = new EventSource(`${apiBase()}/v1/admin/stream?token=${encodeURIComponent(token)}`);
  const refreshEvents = ['heartbeat', 'change_requested', 'change_result', 'import_committed', 'teacher_updated', 'events_cleared'];
  refreshEvents.forEach((event) => source.addEventListener(event, onEvent));
  return () => source.close();
};
