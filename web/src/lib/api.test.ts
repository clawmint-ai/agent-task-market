import { describe, it, expect, vi, afterEach } from 'vitest';
import { type ApiError, request } from './api';

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch);
}

describe('request', () => {
  it('returns parsed JSON on success', async () => {
    mockFetch(200, { hello: 'world' });
    await expect(request('GET', '/x', { key: 'k' })).resolves.toEqual({ hello: 'world' });
  });

  it('maps a string error envelope to ApiError.message', async () => {
    mockFetch(402, { error: 'Insufficient credits' });
    await expect(request('POST', '/x', { key: 'k' })).rejects.toMatchObject({
      status: 402, message: 'Insufficient credits',
    } satisfies Partial<ApiError>);
  });

  it('maps a zod flatten envelope (formErrors) to a joined message', async () => {
    mockFetch(400, { error: { formErrors: ['bad title'], fieldErrors: {} } });
    await expect(request('POST', '/x', { key: 'k' })).rejects.toMatchObject({
      status: 400, message: 'bad title',
    });
  });
});
