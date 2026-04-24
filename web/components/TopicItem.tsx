import { Topic } from '@/lib/types';

export function TopicItem({ topic, active, onSelect }: {
  topic: Topic; active: boolean; onSelect: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(topic.id)}
      className={
        'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm text-left transition ' +
        (active
          ? 'bg-blue-400/20 text-blue-100 font-semibold border-l-2 border-blue-400'
          : 'hover:bg-white/[0.05] text-neutral-200')
      }
    >
      <span className="flex items-center gap-1 truncate">
        {topic.is_hot && <span aria-label="hot">🔥</span>}
        <span>{topic.name}</span>
      </span>
      <span className={'ml-1 text-[10px] px-1.5 py-px rounded-full shrink-0 ' +
        (active ? 'bg-blue-400/40 text-white' : 'bg-white/[0.07] text-neutral-400')}>
        {topic.item_count}
      </span>
    </button>
  );
}
