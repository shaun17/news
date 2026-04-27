import { Item, Topic } from '@/lib/types';
import { ItemCard } from './ItemCard';
import { FilterBar } from './FilterBar';

export function ItemFeed({ items, activeTopic, onClearTopic }: {
  items: Item[]; activeTopic: Topic | null; onClearTopic: () => void;
}) {
  return (
    <div className="flex-1 min-w-0">
      <ScopeHeader activeTopic={activeTopic} count={items.length} />
      {activeTopic && <FilterBar topic={activeTopic} onClear={onClearTopic} />}
      {items.length === 0 ? (
        <div className="text-zinc-500 text-sm py-12 text-center font-mono uppercase tracking-wider">
          no items yet — n8n workflow may still be running
        </div>
      ) : (
        <div className="-mt-1">
          {items.map(it => <ItemCard key={it.id} item={it} />)}
        </div>
      )}
    </div>
  );
}

function ScopeHeader({ activeTopic, count }: {
  activeTopic: Topic | null; count: number;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-1 mb-4 px-1 py-3 bg-zinc-950/90 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/70 hairline">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className={
            'font-mono text-[10px] uppercase tracking-[0.2em] shrink-0 ' +
            (activeTopic ? 'text-amber-300' : 'text-zinc-500')
          }>
            {activeTopic ? 'TOPIC' : 'STREAM'}
          </span>
          <h2 className="font-display text-xl leading-none truncate text-zinc-50">
            {activeTopic ? activeTopic.name : '全部信息流'}
          </h2>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-zinc-500 shrink-0">
          {count} items
        </span>
      </div>
    </div>
  );
}
