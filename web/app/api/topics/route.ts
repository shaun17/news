import { n8n } from '@/lib/api';
export async function GET() {
  try { return Response.json(await n8n.topics()); }
  catch (e: unknown) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
}
