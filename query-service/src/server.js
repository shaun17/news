'use strict';

const http = require('node:http');
const { getTopicDetail, listItems, listTopics } = require('./repository');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const VALID_SOURCES = new Set(['hn', 'reddit', 'x']);

// 统一生成 JSON 响应，让所有出口都带稳定 content-type。
const json = (body, status = 200) => Response.json(body, {
  status,
  headers: JSON_HEADERS,
});

// 把 URL 参数解析成安全的正整数；非法值使用默认值。
const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
};

// 把 URL 参数解析成非负整数；非法值使用默认值。
const parseNonNegativeInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
};

// 限制分页范围，避免公开查询接口被大 limit 拖垮数据库。
const parseItemQuery = (url) => {
  const topic = url.searchParams.get('topic');
  const source = url.searchParams.get('source');
  const limit = Math.min(parsePositiveInt(url.searchParams.get('limit'), 50), 200);
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 0);

  return {
    topic: topic ? parsePositiveInt(topic, 0) || null : null,
    source: source && VALID_SOURCES.has(source) ? source : null,
    limit,
    offset,
  };
};

// 校验共享密钥；health 不鉴权，业务查询都必须通过前台服务转发。
const isAuthorized = (request, secret) => {
  if (!secret) return true;
  return request.headers.get('X-News-API-Secret') === secret;
};

// 创建 query service 应用对象，测试可以直接调用 handle，不需要真的监听端口。
const createQueryService = ({ pool, secret }) => ({
  async handle(request) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true });
    }

    if (!isAuthorized(request, secret)) {
      return json({ error: 'unauthorized' }, 401);
    }

    try {
      if (request.method === 'GET' && url.pathname === '/topics') {
        return json({ topics: await listTopics(pool) });
      }

      if (request.method === 'GET' && url.pathname === '/items') {
        return json({ items: await listItems(pool, parseItemQuery(url)) });
      }

      if (request.method === 'GET' && url.pathname === '/topic-detail') {
        const id = parsePositiveInt(url.searchParams.get('id'), 0);
        if (!id) return json({ error: 'invalid topic id' }, 400);

        const topic = await getTopicDetail(pool, id);
        if (!topic) return json({ error: 'topic not found' }, 404);
        return json({ topic });
      }

      return json({ error: 'not found' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: 'query failed' }, 500);
    }
  },
});

// 按环境变量创建 Postgres 连接池，避免测试加载模块时强制依赖 pg。
const createPoolFromEnv = () => {
  const { Pool } = require('pg');
  return new Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'news',
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || undefined,
    ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : false,
  });
};

// 启动 Node HTTP 服务；部署在 mini 上由 launchd 托管。
const start = () => {
  const port = Number(process.env.QUERY_SERVICE_PORT || 8788);
  const pool = createPoolFromEnv();
  const app = createQueryService({
    pool,
    secret: process.env.NEWS_API_SECRET || '',
  });

  const server = http.createServer(async (req, res) => {
    const origin = `http://${req.headers.host || `127.0.0.1:${port}`}`;
    const request = new Request(new URL(req.url || '/', origin), {
      method: req.method,
      headers: req.headers,
    });
    const response = await app.handle(request);

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(await response.text());
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`news query service listening on 127.0.0.1:${port}`);
  });
};

if (require.main === module) {
  start();
}

module.exports = {
  createQueryService,
  start,
};
