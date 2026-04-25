import { Topic } from '@/lib/types';
import { TopicItem } from './TopicItem';

export function TopicSidebar({ topics, activeId, onSelect }: {
  topics: Topic[]; activeId: number | null; onSelect: (id: number | null) => void;
}) {
  const main   = topics.filter(t => !t.is_rising);
  const rising = topics.filter(t =>  t.is_rising);

  return (
    <aside className="w-48 shrink-0 bg-white/[0.04] rounded-lg p-3 self-start">
      <Section title="本周主题" topics={main}   activeId={activeId} onSelect={onSelect} />
      {rising.length > 0 && (
        <Section title="上升中" topics={rising} activeId={activeId} onSelect={onSelect} />
      )}
    </aside>
  );
}

function Section({ title, topics, activeId, onSelect }: {
  title: string; topics: Topic[]; activeId: number | null; onSelect: (id: number | null) => void;
}) {
  return (
    <div className="mb-3">
      <div className="text-[10px] font-semibold text-blue-300 uppercase tracking-wide mb-1.5">{title}</div>
      <div className="flex flex-col gap-0.5">
        {topics.map(t => (
          <TopicItem key={t.id} topic={t} active={t.id === activeId}
            onSelect={(id) => onSelect(id === activeId ? null : id)} />
        ))}
      </div>
    </div>
  );
}
