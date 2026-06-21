import { api } from '@/lib/api';
export async function GET() {
  try { return Response.json(await api.topics()); }
  catch (e: unknown) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
}
