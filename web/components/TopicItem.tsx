import { Topic } from '@/lib/types';

export function TopicItem({ topic, active, onSelect }: {
  topic: Topic; active: boolean; onSelect: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(topic.id)}
      aria-pressed={active}
      className={
        'group relative w-full flex items-center justify-between gap-2 pl-3.5 pr-2 py-2 text-sm text-left transition ' +
        (active
          ? 'bg-amber-300 text-zinc-950 font-semibold indicator'
          : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-50')
      }
    >
      <span className="flex items-center gap-1.5 truncate min-w-0">
        {topic.is_hot && <span aria-label="hot" className="shrink-0 text-[11px]">🔥</span>}
        <span className="truncate">{topic.name}</span>
      </span>
      <span className={
        'ml-1 text-[10px] px-1.5 py-px shrink-0 tabular-nums font-mono ' +
        (active ? 'bg-zinc-950 text-amber-200' : 'bg-zinc-800 text-zinc-500 group-hover:text-zinc-300')
      }>
        {topic.item_count}
      </span>
    </button>
  );
}
