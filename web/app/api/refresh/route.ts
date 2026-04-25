import { n8n } from '@/lib/api';
export async function POST() {
  try { return Response.json(await n8n.refresh()); }
  catch (e: unknown) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
}
