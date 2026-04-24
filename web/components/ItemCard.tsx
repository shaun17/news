import { Item } from '@/lib/types';

const SRC_LABEL: Record<Item['source'], string> = { hn: 'HN', reddit: 'Reddit', x: 'X' };
const SRC_COLOR: Record<Item['source'], string> = {
  hn:     'text-orange-400',
  reddit: 'text-green-400',
  x:      'text-pink-400'
};

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)     return 'just now';
  if (diff < 3600)   return `${Math.floor(diff/60)}m`;
  if (diff < 86400)  return `${Math.floor(diff/3600)}h`;
  return `${Math.floor(diff/86400)}d`;
}

export function ItemCard({ item }: { item: Item }) {
  return (
    <article className="bg-white/[0.03] hover:bg-white/[0.06] rounded-md p-3 mb-2 transition">
      <div className="flex items-center gap-2 text-xs">
        <span className={`font-bold ${SRC_COLOR[item.source]}`}>{SRC_LABEL[item.source]}</span>
        <span className="text-neutral-500">· {timeAgo(item.published_at)}</span>
        {item.sub_or_handle && <span className="text-neutral-500">· {item.sub_or_handle}</span>}
      </div>
      <h3 className="mt-1 text-[15px] leading-snug text-neutral-100">
        <a href={item.post_url} target="_blank" rel="noreferrer" className="hover:underline">{item.title}</a>
      </h3>
      <div className="mt-1 text-xs text-neutral-500">
        {item.score} · {item.comment_count ?? 0} comments
      </div>
    </article>
  );
}
