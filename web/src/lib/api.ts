const API = '/api/v1';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

function messageFromEnvelope(status: number, data: any): string {
  const e = data?.error;
  if (typeof e === 'string') return e;
  if (e?.formErrors?.length) return e.formErrors.join(', ');
  if (e?.fieldErrors) {
    const msgs = Object.values(e.fieldErrors).flat().filter(Boolean) as string[];
    if (msgs.length) return msgs.join(', ');
  }
  if (typeof data?.message === 'string') return data.message;
  return `Error ${status}`;
}

export async function request<T = unknown>(
  method: string,
  path: string,
  opts: { key?: string | null; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.key) headers.Authorization = `Bearer ${opts.key}`;
  const res = await fetch(API + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, messageFromEnvelope(res.status, data));
  return data as T;
}
