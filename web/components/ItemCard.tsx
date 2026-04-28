import { Item } from '@/lib/types';

const SRC_LABEL: Record<Item['source'], string> = { hn: 'HN', reddit: 'REDDIT', x: 'X' };
const SRC_COLOR: Record<Item['source'], string> = {
  hn:     'text-orange-400',
  reddit: 'text-emerald-400',
  x:      'text-red-400'
};

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)     return 'JUST NOW';
  if (diff < 3600)   return `${Math.floor(diff/60)}M AGO`;
  if (diff < 86400)  return `${Math.floor(diff/3600)}H AGO`;
  return `${Math.floor(diff/86400)}D AGO`;
}

export function ItemCard({ item }: { item: Item }) {
  return (
    <article className="group border-b border-zinc-800/80 px-1 py-4 hover:bg-zinc-900/40 transition">
      <div className="flex items-center gap-2 text-[10px] font-mono tracking-wider uppercase text-zinc-500">
        <span className={`font-semibold ${SRC_COLOR[item.source]}`}>{SRC_LABEL[item.source]}</span>
        <span className="text-zinc-700">·</span>
        <span>{timeAgo(item.published_at)}</span>
        {item.sub_or_handle && (
          <>
            <span className="text-zinc-700">·</span>
            <span className="normal-case tracking-normal text-zinc-400">{item.sub_or_handle}</span>
          </>
        )}
      </div>

      <h3 className="mt-1.5 font-display text-[17px] leading-snug text-zinc-50">
        <a href={item.post_url} target="_blank" rel="noreferrer" className="hover:text-amber-200 transition">
          {item.title}
        </a>
      </h3>

      {item.body && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400 line-clamp-2">{item.body}</p>
      )}

      <div className="mt-2 flex items-center gap-3 text-[11px] font-mono text-zinc-500 tabular-nums">
        <span><span className="text-zinc-300">{item.score}</span> pts</span>
        <span className="text-zinc-700">·</span>
        <span><span className="text-zinc-300">{item.comment_count ?? 0}</span> comments</span>
      </div>
    </article>
  );
}
