import { Suspense } from 'react';
import { HomeClient } from '@/components/HomeClient';
import { N8N_BASE } from '@/lib/env';
import type { Item, Topic } from '@/lib/types';

async function load(topicId: number | null): Promise<{ topics: Topic[]; items: Item[] }> {
  try {
    const itemsUrl = topicId
      ? `${N8N_BASE}/webhook/items?limit=50&topic=${topicId}`
      : `${N8N_BASE}/webhook/items?limit=50`;
    const [t, i] = await Promise.all([
      fetch(`${N8N_BASE}/webhook/topics`, { cache: 'no-store' }).then(r => r.json()),
      fetch(itemsUrl, { cache: 'no-store' }).then(r => r.json())
    ]);
    return { topics: t.topics ?? [], items: i.items ?? [] };
  } catch { return { topics: [], items: [] }; }
}

export default async function Page({ searchParams }: { searchParams: { topic?: string } }) {
  const topicId = searchParams.topic ? Number(searchParams.topic) : null;
  const { topics, items } = await load(topicId);
  return (
    <Suspense fallback={<div className="text-zinc-400 text-sm p-6">Loading…</div>}>
      <HomeClient initialTopics={topics} initialItems={items} initialTopicId={topicId} />
    </Suspense>
  );
}
