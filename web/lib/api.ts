import { N8N_BASE, NEWS_API_SECRET } from './env';

export function n8nAuthHeaders(): Record<string, string> {
  // 所有服务端到 n8n 的请求都走同一个鉴权头，避免漏掉 SSR 首屏请求。
  return NEWS_API_SECRET ? { 'X-News-API-Secret': NEWS_API_SECRET } : {};
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${N8N_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...n8nAuthHeaders(), ...(init?.headers || {}) },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`n8n ${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export const n8n = {
  topics:        () => call<{ topics: import('./types').Topic[] }>('/webhook/topics'),
  items:         (q: { topic?: number; source?: string; limit?: number; offset?: number } = {}) => {
    const u = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v != null && u.set(k, String(v)));
    return call<{ items: import('./types').Item[] }>(`/webhook/items?${u}`);
  },
  topicDetail:   (id: number) => call<{ topic: import('./types').Topic; items: import('./types').Item[] }>(`/webhook/topic-detail?id=${id}`),
  refresh:       () => call<{ triggered: boolean; ts: string }>('/webhook/refresh', { method: 'POST' })
};
