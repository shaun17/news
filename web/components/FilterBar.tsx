import { Topic } from '@/lib/types';

export function FilterBar({ topic, onClear }: { topic: Topic; onClear: () => void }) {
  return (
    <div className="bg-blue-400/10 border-l-2 border-blue-400 px-3 py-2 rounded mb-3 flex items-center gap-3">
      <div className="flex-1 text-sm">
        <span>{'🔍'} <strong className="text-blue-200">{topic.name}</strong></span>
        {topic.summary && <span className="text-neutral-300 ml-2">· {topic.summary}</span>}
      </div>
      <button onClick={onClear} className="text-xs text-pink-300 hover:text-pink-200">× 清除</button>
    </div>
  );
}
