import { Item, Topic } from '@/lib/types';
import { ItemCard } from './ItemCard';
import { FilterBar } from './FilterBar';

export function ItemFeed({ items, activeTopic, onClearTopic }: {
  items: Item[]; activeTopic: Topic | null; onClearTopic: () => void;
}) {
  return (
    <div className="flex-1 min-w-0">
      {activeTopic && <FilterBar topic={activeTopic} onClear={onClearTopic} />}
      {items.length === 0 ? (
        <div className="text-neutral-400 text-sm py-8 text-center">
          近期还没有 AI 热点（n8n 工作流可能还没跑完）
        </div>
      ) : items.map(it => <ItemCard key={it.id} item={it} />)}
    </div>
  );
}
