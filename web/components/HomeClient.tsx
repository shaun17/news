'use client';

import useSWR, { mutate } from 'swr';
import { useSearchParams, useRouter } from 'next/navigation';
import { Item, Topic } from '@/lib/types';
import { TopicSidebar } from './TopicSidebar';
import { ItemFeed } from './ItemFeed';
import { RefreshButton } from './RefreshButton';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function HomeClient(props: {
  initialTopics: Topic[];
  initialItems: Item[];
  initialTopicId: number | null;
}) {
  const search  = useSearchParams();
  const router  = useRouter();
  // SSR 时 useSearchParams 在 client component 内取不到 query，
  // 用 server 传入的 initialTopicId 兜底，避免首屏渲染默认状态后再 hydrate 闪烁。
  const urlTopic = search.get('topic');
  const topicId  = urlTopic ? Number(urlTopic) : props.initialTopicId;

  const { data: topicsData } = useSWR<{ topics: Topic[] }>(
    '/api/topics', fetcher, { fallbackData: { topics: props.initialTopics }, refreshInterval: 5*60*1000 }
  );
  const { data: itemsData } = useSWR<{ items: Item[] }>(
    `/api/items${topicId ? `?topic=${topicId}` : ''}`,
    fetcher,
    { fallbackData: { items: props.initialItems }, refreshInterval: 5*60*1000 }
  );

  // n8n webhook 把 BIGINT 序列化成字符串；统一在 normalize 这一层转回 number，
  // 避免下游每个 === 比较都要担心类型不匹配。
  const topics = (topicsData?.topics ?? []).map(t => ({ ...t, id: Number(t.id) }));
  const items  = (itemsData?.items  ?? []).map(i => ({ ...i, id: Number(i.id) }));
  const activeTopic = topics.find(t => t.id === topicId) || null;

  const setTopic = (id: number | null) => {
    const u = new URLSearchParams(search.toString());
    if (id == null) u.delete('topic'); else u.set('topic', String(id));
    router.push(`/?${u.toString()}`);
  };

  const refresh = async () => {
    await fetch('/api/refresh', { method: 'POST' });
    setTimeout(() => {
      mutate('/api/topics');
      mutate(`/api/items${topicId ? `?topic=${topicId}` : ''}`);
    }, 60*1000);
  };

  return (
    <div className="max-w-6xl mx-auto px-6 pt-8 pb-12">
      <header className="flex items-end justify-between gap-4 pb-5 mb-6 border-b border-zinc-800">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-300/80 mb-1">
            wire · ai signal
          </p>
          <h1 className="font-display text-3xl leading-none text-zinc-50 tracking-tight">
            AI 信息热点
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 hidden sm:inline">
            HN · Reddit · X
          </span>
          <RefreshButton onRefresh={refresh} />
        </div>
      </header>

      <div className="flex gap-6">
        <TopicSidebar topics={topics} activeId={topicId} onSelect={setTopic} />
        <ItemFeed items={items} activeTopic={activeTopic} onClearTopic={() => setTopic(null)} />
      </div>
    </div>
  );
}
