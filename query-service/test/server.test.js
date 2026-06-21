const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createQueryService } = require('../src/server');

const createPool = (handler) => ({
  queries: [],
  async query(sql, values = []) {
    this.queries.push({ sql, values });
    return handler(sql, values);
  },
});

test('rejects protected query requests without the shared secret', async () => {
  const app = createQueryService({
    secret: 'secret',
    pool: createPool(() => ({ rows: [] })),
  });

  const response = await app.handle(new Request('http://query.local/topics'));

  assert.equal(response.status, 401);
});

test('loads topics from postgres and keeps the response shape stable', async () => {
  const pool = createPool(() => ({
    rows: [{
      id: '12',
      name: 'AI Agents',
      summary: 'agent news',
      item_count: 3,
      source_count: 2,
      total_score: '42',
      is_hot: true,
      is_rising: false,
      last_active_at: '2026-06-21T08:00:00.000Z',
    }],
  }));
  const app = createQueryService({ secret: 'secret', pool });

  const response = await app.handle(new Request('http://query.local/topics', {
    headers: { 'X-News-API-Secret': 'secret' },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    topics: [{
      id: 12,
      name: 'AI Agents',
      summary: 'agent news',
      item_count: 3,
      source_count: 2,
      total_score: 42,
      is_hot: true,
      is_rising: false,
      last_active_at: '2026-06-21T08:00:00.000Z',
    }],
  });
});

test('clamps item query pagination before querying postgres', async () => {
  const pool = createPool(() => ({ rows: [] }));
  const app = createQueryService({ secret: 'secret', pool });

  const response = await app.handle(new Request('http://query.local/items?limit=999&offset=-9&topic=7&source=hn', {
    headers: { 'X-News-API-Secret': 'secret' },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(pool.queries[0].values, [7, 'hn', 200, 0]);
});

test('returns topic detail and related items from postgres', async () => {
  const pool = createPool((sql) => {
    if (sql.includes('FROM topics')) {
      return { rows: [{ id: '9', name: 'Robotics', key_entities: ['robot'], item_count: 1, source_count: 1, total_score: '5', is_hot: false, is_rising: true, first_seen_at: '2026-06-21T07:00:00.000Z', last_active_at: '2026-06-21T08:00:00.000Z' }] };
    }
    return { rows: [{ id: '3', source: 'hn', source_id: 'abc', title: 'Item', body: null, post_url: 'https://example.com', link_url: null, author: null, sub_or_handle: null, score: 5, comment_count: null, published_at: '2026-06-21T08:00:00.000Z' }] };
  });
  const app = createQueryService({ secret: 'secret', pool });

  const response = await app.handle(new Request('http://query.local/topic-detail?id=9', {
    headers: { 'X-News-API-Secret': 'secret' },
  }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).topic.items[0].id, 3);
});
