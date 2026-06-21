import { api } from '@/lib/api';
export async function POST() {
  try { return Response.json(await api.refresh()); }
  catch (e: unknown) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
}
