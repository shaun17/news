import { n8n } from '@/lib/api';
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = {
    topic:  u.searchParams.get('topic')  ? Number(u.searchParams.get('topic'))  : undefined,
    source: u.searchParams.get('source') || undefined,
    limit:  u.searchParams.get('limit')  ? Number(u.searchParams.get('limit'))  : undefined,
    offset: u.searchParams.get('offset') ? Number(u.searchParams.get('offset')) : undefined
  };
  try { return Response.json(await n8n.items(q)); }
  catch (e: unknown) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
}
