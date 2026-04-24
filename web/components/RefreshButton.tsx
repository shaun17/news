'use client';
import { useState } from 'react';

export function RefreshButton({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } }}
      className="px-3 py-1.5 text-sm rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-blue-100 disabled:opacity-50"
    >
      {busy ? '刷新中…' : '刷新'}
    </button>
  );
}
