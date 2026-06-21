import { N8N_BASE, NEWS_API_SECRET, QUERY_API_BASE } from './env';

export function apiAuthHeaders(): Record<string, string> {
  // 所有服务端请求都走同一个鉴权头，避免 SSR 首屏和 API route 鉴权口径不一致。
  return NEWS_API_SECRET ? { 'X-News-API-Secret': NEWS_API_SECRET } : {};
}

// 统一调用内部服务，读接口走 query service，工作流触发仍走 n8n。
async function call<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...apiAuthHeaders(), ...(init?.headers || {}) },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`api ${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  topics:        () => call<{ topics: import('./types').Topic[] }>(QUERY_API_BASE, '/topics'),
  items:         (q: { topic?: number; source?: string; limit?: number; offset?: number } = {}) => {
    const u = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v != null && u.set(k, String(v)));
    const suffix = u.toString() ? `?${u}` : '';
    return call<{ items: import('./types').Item[] }>(QUERY_API_BASE, `/items${suffix}`);
  },
  topicDetail:   (id: number) => call<{ topic: import('./types').TopicDetail }>(QUERY_API_BASE, `/topic-detail?id=${id}`),
  refresh:       () => call<{ triggered: boolean; ts: string }>(N8N_BASE, '/webhook/refresh', { method: 'POST' })
};
