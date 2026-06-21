'use strict';

const ITEM_COLUMNS = `
  i.id, i.source, i.source_id, i.title, i.body, i.post_url, i.link_url,
  i.author, i.sub_or_handle, i.score, i.comment_count, i.published_at
`;

// 把 Postgres 可能返回的 bigint 字符串统一转成前台已经使用的 number。
const toNumber = (value) => {
  if (value == null) return value;
  return Number(value);
};

// 把 timestamp/date 对象统一序列化，避免不同驱动返回值造成前台渲染差异。
const toIsoString = (value) => {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  return value;
};

// 归一化信息流 item，保持和旧 n8n webhook 返回字段一致。
const mapItem = (row) => ({
  id: toNumber(row.id),
  source: row.source,
  source_id: row.source_id,
  title: row.title,
  body: row.body,
  post_url: row.post_url,
  link_url: row.link_url,
  author: row.author,
  sub_or_handle: row.sub_or_handle,
  score: toNumber(row.score),
  comment_count: row.comment_count == null ? null : toNumber(row.comment_count),
  published_at: toIsoString(row.published_at),
});

// 归一化 topic，避免 total_score 这类 bigint 在 JSON 中变成字符串。
const mapTopic = (row) => ({
  id: toNumber(row.id),
  name: row.name,
  summary: row.summary ?? null,
  item_count: toNumber(row.item_count),
  source_count: toNumber(row.source_count),
  total_score: toNumber(row.total_score),
  is_hot: Boolean(row.is_hot),
  is_rising: Boolean(row.is_rising),
  last_active_at: toIsoString(row.last_active_at),
});

// 归一化 topic 详情，补齐详情页需要的字段。
const mapTopicDetail = (row) => ({
  ...mapTopic(row),
  key_entities: row.key_entities ?? null,
  first_seen_at: toIsoString(row.first_seen_at),
});

// 查询活跃 topic 列表，对应旧 api-topics workflow 的 SQL。
const listTopics = async (pool) => {
  const result = await pool.query(`
    SELECT id, name, summary, item_count, source_count, total_score,
           is_hot, is_rising, last_active_at
    FROM topics
    WHERE archived_at IS NULL
    ORDER BY last_active_at DESC, id DESC
    LIMIT 50;
  `);
  return result.rows.map(mapTopic);
};

// 查询信息流列表，对应旧 api-items workflow，并使用参数化 SQL 代替 n8n 模板拼接。
const listItems = async (pool, params) => {
  const result = await pool.query(`
    SELECT ${ITEM_COLUMNS}
    FROM items i
    LEFT JOIN item_topics it ON it.item_id = i.id
    WHERE i.is_ai_relevant IS NOT FALSE
      AND ($1::bigint IS NULL OR it.topic_id = $1::bigint)
      AND ($2::text IS NULL OR i.source = $2::text)
    ORDER BY i.published_at DESC
    LIMIT $3::int
    OFFSET $4::int;
  `, [params.topic, params.source, params.limit, params.offset]);
  return result.rows.map(mapItem);
};

// 查询单个 topic 详情，topic 和关联 item 分开查，保持边界清楚。
const getTopicDetail = async (pool, id) => {
  const topicResult = await pool.query(`
    SELECT id, name, summary, key_entities, item_count, source_count, total_score,
           is_hot, is_rising, first_seen_at, last_active_at
    FROM topics
    WHERE id = $1::bigint;
  `, [id]);

  if (topicResult.rows.length === 0) return null;

  const itemsResult = await pool.query(`
    SELECT ${ITEM_COLUMNS}
    FROM items i
    JOIN item_topics it ON it.item_id = i.id
    WHERE it.topic_id = $1::bigint
    ORDER BY i.published_at DESC
    LIMIT 100;
  `, [id]);

  return {
    ...mapTopicDetail(topicResult.rows[0]),
    items: itemsResult.rows.map(mapItem),
  };
};

module.exports = {
  getTopicDetail,
  listItems,
  listTopics,
};
