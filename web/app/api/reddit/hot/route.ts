import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

// Reddit 推荐的 UA 格式 <platform>:<app>:<version> (by /u/<owner>)，
// 比通用浏览器 UA 更不容易被 reddit anti-abuse 直接 block。
const REDDIT_USER_AGENT = 'macos:news-aggregator:0.1 (by /u/wenrencc)';
const ALLOWED_SUBS = new Set([
  'LocalLLaMA',
  'MachineLearning',
  'singularity',
  'OpenAI',
  'ClaudeAI',
  'StableDiffusion'
]);

const CACHE_TTL_MS  = 5 * 60 * 1000;   // 5 分钟内同 sub 复用上次成功结果
const STALE_TTL_MS  = 60 * 60 * 1000;  // 1 小时内 reddit 报错时仍回上次成功 payload

type Cached = { body: string; ts: number };
const cache = new Map<string, Cached>();

const normalizeSubreddit = (value: string | null) =>
  value && ALLOWED_SUBS.has(value) ? value : null;

const normalizeLimit = (value: string | null) => {
  const parsed = value ? Number(value) : 25;
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(Math.trunc(parsed), 1), 50);
};

async function fetchRedditViaProxy(redditUrl: string, proxy: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/curl', [
    '-fsSL',
    '--connect-timeout', '10',
    '--max-time', '30',
    '--retry', '2',
    '--retry-delay', '2',
    '--compressed',
    '--proxy', proxy,
    '-A', REDDIT_USER_AGENT,
    '-H', 'Accept: application/json,*/*;q=0.8',
    redditUrl
  ], { maxBuffer: 1024 * 1024 });
  return stdout;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sub = normalizeSubreddit(url.searchParams.get('sub'));
  const proxy = process.env.MBP_PROXY;

  if (!sub) {
    return Response.json({ error: 'unsupported subreddit' }, { status: 400 });
  }
  if (!proxy) {
    return Response.json({ error: 'MBP_PROXY is not configured' }, { status: 500 });
  }

  const limit = normalizeLimit(url.searchParams.get('limit'));
  const cacheKey = `${sub}:${limit}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);

  // 出口 IP 共享导致 reddit 经常 429；命中 fresh cache 直接返回，不打 reddit。
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return new Response(cached.body, {
      headers: { 'content-type': 'application/json', 'x-cache': 'fresh' }
    });
  }

  const redditUrl = `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=${limit}&raw_json=1`;
  try {
    const body = await fetchRedditViaProxy(redditUrl, proxy);
    JSON.parse(body); // 校验是合法 JSON 再写缓存，避免缓存到错误页
    cache.set(cacheKey, { body, ts: now });
    return new Response(body, {
      headers: { 'content-type': 'application/json', 'x-cache': 'miss' }
    });
  } catch {
    // 当前请求失败但 1 小时内有 stale cache 就回 stale，避免上游 fetcher 拿到空数组。
    if (cached && now - cached.ts < STALE_TTL_MS) {
      return new Response(cached.body, {
        headers: { 'content-type': 'application/json', 'x-cache': 'stale' }
      });
    }
    return Response.json({ error: 'reddit fetch failed' }, { status: 502 });
  }
}
