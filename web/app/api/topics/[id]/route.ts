import { n8n } from '@/lib/api';
type TopicRouteContext = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: TopicRouteContext) {
  try {
    // Next 15 动态路由参数是异步读取，统一 await 后再访问 topic id。
    const { id } = await params;
    return Response.json(await n8n.topicDetail(Number(id)));
  }
  catch (e: unknown) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
}
