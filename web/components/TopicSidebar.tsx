import { Topic } from '@/lib/types';
import { TopicItem } from './TopicItem';

export function TopicSidebar({ topics, activeId, onSelect }: {
  topics: Topic[]; activeId: number | null; onSelect: (id: number | null) => void;
}) {
  const main   = topics.filter(t => !t.is_rising);
  const rising = topics.filter(t =>  t.is_rising);
  const totalCount = topics.reduce((sum, t) => sum + (t.item_count || 0), 0);
  const allActive = activeId === null;

  return (
    <aside className="w-56 shrink-0 self-start border border-zinc-800 bg-zinc-900/40">
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={allActive}
        className={
          'relative w-full flex items-center justify-between gap-2 pl-3.5 pr-2 py-2.5 text-sm text-left transition border-b border-zinc-800 ' +
          (allActive
            ? 'bg-amber-300 text-zinc-950 font-semibold indicator'
            : 'text-zinc-100 hover:bg-zinc-800/60')
        }
      >
        <span className="font-display text-[15px] tracking-tight">全部信息流</span>
        <span className={
          'ml-1 text-[10px] px-1.5 py-px shrink-0 tabular-nums font-mono ' +
          (allActive ? 'bg-zinc-950 text-amber-200' : 'bg-zinc-800 text-zinc-500')
        }>
          {totalCount}
        </span>
      </button>

      <div className="py-2">
        <Section title="本周主题" topics={main}   activeId={activeId} onSelect={onSelect} />
        {rising.length > 0 && (
          <Section title="上升中" topics={rising} activeId={activeId} onSelect={onSelect} />
        )}
      </div>
    </aside>
  );
}

function Section({ title, topics, activeId, onSelect }: {
  title: string; topics: Topic[]; activeId: number | null; onSelect: (id: number | null) => void;
}) {
  if (topics.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="px-3.5 pt-1.5 pb-1 text-[10px] font-mono font-medium text-amber-200/70 uppercase tracking-[0.18em]">
        {title}
      </div>
      <div className="flex flex-col">
        {topics.map(t => (
          <TopicItem
            key={t.id}
            topic={t}
            active={t.id === activeId}
            onSelect={(id) => onSelect(id === activeId ? null : id)}
          />
        ))}
      </div>
    </div>
  );
}
