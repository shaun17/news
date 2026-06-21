import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('api clients', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      QUERY_API_BASE: 'https://news-query.example.com',
      N8N_WEBHOOK_BASE: 'https://n8n.example.com',
      NEWS_API_SECRET: 'secret',
    };
    global.fetch = vi.fn(async () => Response.json({ ok: true })) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('routes read queries to the query service', async () => {
    const { api } = await import('./api');

    await api.items({ topic: 7, limit: 50 });
    await api.topics();

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://news-query.example.com/items?topic=7&limit=50',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ 'X-News-API-Secret': 'secret' }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://news-query.example.com/topics',
      expect.any(Object),
    );
  });

  it('keeps refresh on n8n because it triggers workflow execution', async () => {
    const { api } = await import('./api');

    await api.refresh();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://n8n.example.com/webhook/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
