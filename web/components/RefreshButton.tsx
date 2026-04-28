'use client';
import { useState } from 'react';

export function RefreshButton({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'pending'>('idle');

  return (
    <button
      type="button"
      disabled={state === 'pending'}
      onClick={async () => {
        setState('pending');
        try {
          await onRefresh();
        } finally {
          setTimeout(() => setState('idle'), 60_000);
        }
      }}
      className={
        'font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border transition ' +
        (state === 'pending'
          ? 'border-zinc-700 text-zinc-500 cursor-default'
          : 'border-amber-300 text-amber-200 hover:bg-amber-300 hover:text-zinc-950')
      }
    >
      {state === 'pending' ? '· · ·  ingesting' : '↻ refresh'}
    </button>
  );
}
