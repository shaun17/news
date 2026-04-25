import { n8n } from '@/lib/api';
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try { return Response.json(await n8n.topicDetail(Number(params.id))); }
  catch (e: unknown) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
}
