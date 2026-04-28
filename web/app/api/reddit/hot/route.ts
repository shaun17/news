export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

async function fetchReddit(redditUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    // Cloudflare Workers 不支持本机 curl/proxy，这里必须使用平台 fetch。
    const response = await fetch(redditUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json,*/*;q=0.8',
        'User-Agent': REDDIT_USER_AGENT
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`reddit ${response.status}`);
    }

    const body = await response.text();
    JSON.parse(body); // 校验是合法 JSON 再写缓存，避免缓存到错误页
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sub = normalizeSubreddit(url.searchParams.get('sub'));

  if (!sub) {
    return Response.json({ error: 'unsupported subreddit' }, { status: 400 });
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
    const body = await fetchReddit(redditUrl);
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
