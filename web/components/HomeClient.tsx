'use client';

import useSWR, { mutate } from 'swr';
import { useSearchParams, useRouter } from 'next/navigation';
import { Item, Topic } from '@/lib/types';
import { TopicSidebar } from './TopicSidebar';
import { ItemFeed } from './ItemFeed';
import { RefreshButton } from './RefreshButton';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function HomeClient(props: { initialTopics: Topic[]; initialItems: Item[] }) {
  const search  = useSearchParams();
  const router  = useRouter();
  const topicId = search.get('topic') ? Number(search.get('topic')) : null;

  const { data: topicsData } = useSWR<{ topics: Topic[] }>(
    '/api/topics', fetcher, { fallbackData: { topics: props.initialTopics }, refreshInterval: 5*60*1000 }
  );
  const { data: itemsData } = useSWR<{ items: Item[] }>(
    `/api/items${topicId ? `?topic=${topicId}` : ''}`,
    fetcher,
    { fallbackData: { items: props.initialItems }, refreshInterval: 5*60*1000 }
  );

  const topics = topicsData?.topics ?? [];
  const items  = itemsData?.items  ?? [];
  const activeTopic = topics.find(t => t.id === topicId) || null;

  const setTopic = (id: number | null) => {
    const u = new URLSearchParams(search.toString());
    if (id == null) u.delete('topic'); else u.set('topic', String(id));
    router.push(`/?${u.toString()}`);
  };

  const refresh = async () => {
    await fetch('/api/refresh', { method: 'POST' });
    setTimeout(() => { mutate('/api/topics'); mutate(`/api/items${topicId ? `?topic=${topicId}` : ''}`); }, 60*1000);
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-neutral-100">AI 信息热点</h1>
        <RefreshButton onRefresh={refresh} />
      </header>
      <div className="flex gap-4">
        <TopicSidebar topics={topics} activeId={topicId} onSelect={setTopic} />
        <ItemFeed items={items} activeTopic={activeTopic} onClearTopic={() => setTopic(null)} />
      </div>
    </div>
  );
}
