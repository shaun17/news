import { Suspense } from 'react';
import { HomeClient } from '@/components/HomeClient';
import { N8N_BASE } from '@/lib/env';
import type { Item, Topic } from '@/lib/types';

async function load(): Promise<{ topics: Topic[]; items: Item[] }> {
  try {
    const [t, i] = await Promise.all([
      fetch(`${N8N_BASE}/webhook/topics`,        { cache: 'no-store' }).then(r => r.json()),
      fetch(`${N8N_BASE}/webhook/items?limit=50`, { cache: 'no-store' }).then(r => r.json())
    ]);
    return { topics: t.topics ?? [], items: i.items ?? [] };
  } catch { return { topics: [], items: [] }; }
}

export default async function Page() {
  const { topics, items } = await load();
  return (
    <Suspense fallback={<div className="text-neutral-400 text-sm p-6">Loading...</div>}>
      <HomeClient initialTopics={topics} initialItems={items} />
    </Suspense>
  );
}
