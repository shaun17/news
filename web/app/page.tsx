import { Suspense } from 'react';
import { HomeClient } from '@/components/HomeClient';
import { n8nAuthHeaders } from '@/lib/api';
import { N8N_BASE } from '@/lib/env';
import type { Item, Topic } from '@/lib/types';

async function load(topicId: number | null): Promise<{ topics: Topic[]; items: Item[] }> {
  try {
    // 首屏 SSR 也直接访问 n8n，因此必须和 API route 一样带共享密钥。
    const headers = n8nAuthHeaders();
    const itemsUrl = topicId
      ? `${N8N_BASE}/webhook/items?limit=50&topic=${topicId}`
      : `${N8N_BASE}/webhook/items?limit=50`;
    const [t, i] = await Promise.all([
      fetch(`${N8N_BASE}/webhook/topics`, { cache: 'no-store', headers }).then(r => r.json()),
      fetch(itemsUrl, { cache: 'no-store', headers }).then(r => r.json())
    ]);
    return { topics: t.topics ?? [], items: i.items ?? [] };
  } catch { return { topics: [], items: [] }; }
}

type PageProps = { searchParams: Promise<{ topic?: string }> };

export default async function Page({ searchParams }: PageProps) {
  // Next 15 的 App Router 会异步传入 searchParams，先解包再计算当前 topic。
  const { topic } = await searchParams;
  const topicId = topic ? Number(topic) : null;
  const { topics, items } = await load(topicId);
  return (
    <Suspense fallback={<div className="text-zinc-400 text-sm p-6">Loading…</div>}>
      <HomeClient initialTopics={topics} initialItems={items} />
    </Suspense>
  );
}
