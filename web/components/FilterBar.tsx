import { Topic } from '@/lib/types';

export function FilterBar({ topic, onClear }: { topic: Topic; onClear: () => void }) {
  return (
    <div className="border border-amber-300/40 bg-amber-300/[0.06] mb-5">
      <div className="flex items-stretch">
        <div className="w-1 bg-amber-300 shrink-0" aria-hidden />
        <div className="flex-1 min-w-0 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">
              filtered
            </span>
            <span className="font-display text-base leading-none text-amber-100 truncate">
              {topic.name}
            </span>
          </div>
          {topic.summary && (
            <p className="text-[13px] leading-relaxed text-zinc-300">{topic.summary}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 self-stretch px-4 border-l border-amber-300/30 font-mono text-[11px] uppercase tracking-wider text-amber-200 hover:bg-amber-300 hover:text-zinc-950 transition flex items-center gap-1.5"
        >
          <span className="text-base leading-none">×</span>
          <span>清除筛选</span>
        </button>
      </div>
    </div>
  );
}
