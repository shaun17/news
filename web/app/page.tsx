import { Suspense } from 'react';
import { HomeClient } from '@/components/HomeClient';
import { api } from '@/lib/api';
import type { Item, Topic } from '@/lib/types';

async function load(topicId: number | null): Promise<{ topics: Topic[]; items: Item[] }> {
  try {
    // 首屏 SSR 也走 query service，避免刷新页面时绕回 n8n 查询接口。
    const [t, i] = await Promise.all([
      api.topics(),
      api.items(topicId ? { limit: 50, topic: topicId } : { limit: 50 })
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
      <HomeClient initialTopics={topics} initialItems={items} initialTopicId={topicId} />
    </Suspense>
  );
}
