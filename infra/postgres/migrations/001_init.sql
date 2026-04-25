BEGIN;

CREATE TABLE IF NOT EXISTS items (
    id              BIGSERIAL PRIMARY KEY,
    source          TEXT        NOT NULL CHECK (source IN ('hn','reddit','x')),
    source_id       TEXT        NOT NULL,
    title           TEXT        NOT NULL,
    body            TEXT,
    post_url        TEXT        NOT NULL,
    link_url        TEXT,
    author          TEXT,
    sub_or_handle   TEXT,
    score           INTEGER     NOT NULL DEFAULT 0,
    comment_count   INTEGER,
    published_at    TIMESTAMPTZ NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_ai_relevant  BOOLEAN,
    entities        JSONB,
    UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_items_published       ON items (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_source_pub      ON items (source, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_ai_relevant     ON items (is_ai_relevant) WHERE is_ai_relevant = TRUE;
CREATE INDEX IF NOT EXISTS idx_items_unprocessed     ON items (fetched_at)     WHERE is_ai_relevant IS NULL;

CREATE TABLE IF NOT EXISTS topics (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT        NOT NULL,
    summary         TEXT,
    key_entities    JSONB,
    item_count      INTEGER     NOT NULL DEFAULT 0,
    source_count    INTEGER     NOT NULL DEFAULT 0,
    total_score     BIGINT      NOT NULL DEFAULT 0,
    is_hot          BOOLEAN     NOT NULL DEFAULT FALSE,
    is_rising       BOOLEAN     NOT NULL DEFAULT FALSE,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_topics_active ON topics (last_active_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_topics_hot    ON topics (is_hot)              WHERE archived_at IS NULL AND is_hot = TRUE;

CREATE TABLE IF NOT EXISTS item_topics (
    item_id   BIGINT NOT NULL REFERENCES items(id)  ON DELETE CASCADE,
    topic_id  BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_item_topics_topic ON item_topics (topic_id);

COMMIT;
