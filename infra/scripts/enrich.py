#!/usr/bin/env python3
"""Enrich items: AI-relevance filter + entity extraction + topic clustering.

Idempotent. Designed to be re-run by launchd. Pulls items where
is_ai_relevant IS NULL OR (is_ai_relevant=true AND entities IS NULL),
calls Kimi to classify+extract, clusters into topics, refreshes hot/rising flags.

Reads MOONSHOT_API_KEY from env. Uses kimi-k2-0905-preview.
"""
import os, sys, json, re, time, urllib.request, urllib.error
from collections import defaultdict
from datetime import datetime, timezone, timedelta
import psycopg

API_KEY = os.environ["MOONSHOT_API_KEY"]
API_URL = os.environ.get("MOONSHOT_API_URL", "https://api.moonshot.cn/v1/chat/completions")
MODEL   = os.environ.get("MOONSHOT_MODEL", "kimi-k2-0905-preview")

def pg_config():
    """从环境变量读取 Postgres 连接参数，避免在源码里写死部署账号和主机。"""
    return {
        key: value
        for key, value in {
            "dbname": os.environ.get("PGDATABASE"),
            "user": os.environ.get("PGUSER"),
            "host": os.environ.get("PGHOST"),
            "port": os.environ.get("PGPORT"),
            "password": os.environ.get("PGPASSWORD"),
        }.items()
        if value
    }

CLASSIFY_BATCH = 30   # HN items per relevance call
ENTITY_BATCH   = 20   # items per entity-extract call

def kimi(messages, response_format=None, max_tokens=2000, retries=2):
    payload = {"model": MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2}
    if response_format:
        payload["response_format"] = response_format
    body = json.dumps(payload).encode()
    last_err = None
    for attempt in range(retries+1):
        try:
            req = urllib.request.Request(API_URL, data=body,
                  headers={"Authorization": f"Bearer {API_KEY}", "Content-Type":"application/json"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())
                return data["choices"][0]["message"]["content"]
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"kimi call failed: {last_err}")

def extract_json(text):
    """Pull a JSON object/array out of an LLM response, tolerant of code fences."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    # Try as-is, then fallback to first {...} or [...] block
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
    if m:
        return json.loads(m.group(1))
    raise ValueError(f"no JSON in: {text[:200]}")

def classify_hn_relevance(items):
    """Classify HN items as AI-related or not. Mutates items by adding is_ai_relevant."""
    if not items: return
    for chunk_start in range(0, len(items), CLASSIFY_BATCH):
        chunk = items[chunk_start:chunk_start+CLASSIFY_BATCH]
        listing = "\n".join(f"[{i+1}] {it['title']}" + (f" — {(it.get('body') or '')[:200]}" if it.get('body') else "")
                            for i, it in enumerate(chunk))
        prompt = (
            "判断以下每条 Hacker News 帖子是否与人工智能/机器学习/大模型/AI 工具/AI 公司直接相关。\n"
            "对每条返回 true (相关) 或 false (不相关)。严格输出 JSON 数组，长度等于条目数：\n"
            f"[true, false, ...]\n\n条目（共 {len(chunk)} 条）：\n{listing}"
        )
        try:
            out = kimi([{"role":"user","content":prompt}],
                       response_format={"type":"json_object"}, max_tokens=200)
        except Exception as e:
            print(f"[classify] batch failed: {e}", file=sys.stderr); continue
        try:
            arr = extract_json(out)
            if isinstance(arr, dict):
                # model may have wrapped under a key
                arr = next((v for v in arr.values() if isinstance(v, list)), None)
            if not isinstance(arr, list) or len(arr) != len(chunk):
                raise ValueError(f"bad shape: {arr}")
            for it, val in zip(chunk, arr):
                it["is_ai_relevant"] = bool(val)
        except Exception as e:
            print(f"[classify] parse failed: {e} -- raw: {out[:200]}", file=sys.stderr)

def extract_entities(items):
    """Add entities dict to each item."""
    relevant = [it for it in items if it.get("is_ai_relevant")]
    if not relevant: return
    for chunk_start in range(0, len(relevant), ENTITY_BATCH):
        chunk = relevant[chunk_start:chunk_start+ENTITY_BATCH]
        listing = "\n".join(
            f"[{i+1}] {it['title']}" + (f" — {(it.get('body') or '')[:300]}" if it.get('body') else "")
            for i, it in enumerate(chunk))
        prompt = (
            "从以下 AI 相关内容中为每条提取实体。返回严格 JSON：\n"
            "{\"results\": [{\"models\":[],\"people\":[],\"companies\":[],\"products\":[],\"topics\":[]}, ...]}\n"
            "字段说明：models 模型/算法名（如 GPT-5, Claude Opus 4），people 人名，companies 公司/组织，"
            "products 产品/工具，topics 抽象话题词。找不到就空数组。不要解释。\n\n"
            f"条目（共 {len(chunk)} 条，输出 results 数组长度必须等于此）：\n{listing}"
        )
        try:
            out = kimi([{"role":"user","content":prompt}],
                       response_format={"type":"json_object"}, max_tokens=2500)
            data = extract_json(out)
            arr = data.get("results") if isinstance(data, dict) else data
            if not isinstance(arr, list) or len(arr) != len(chunk):
                raise ValueError(f"bad shape: len={len(arr) if isinstance(arr,list) else 'n/a'} expected={len(chunk)}")
            for it, ent in zip(chunk, arr):
                it["entities"] = {k: [str(x) for x in (ent.get(k) or [])][:8]
                                  for k in ("models","people","companies","products","topics")}
        except Exception as e:
            print(f"[entities] parse failed: {e} -- raw: {out[:200] if 'out' in dir() else ''}", file=sys.stderr)

def normalize_entity(s):
    return re.sub(r"[\s\-_/]+", "", s.lower())

def cluster_key(entities):
    """Use models+companies+products as the clustering signal."""
    if not entities: return set()
    keys = set()
    for k in ("models","companies","products"):
        for v in entities.get(k, []):
            n = normalize_entity(v)
            if len(n) >= 2:
                keys.add(n)
    return keys

def assign_topics(con, items):
    """For each AI-relevant item with entities, find or create a topic and link.
    Returns count of new topics created and links written."""
    cur = con.cursor()
    # load existing active topics
    cur.execute("SELECT id, name, key_entities FROM topics WHERE archived_at IS NULL")
    topics = []  # list of (id, name, key_set)
    for tid, tname, ke in cur.fetchall():
        keys = set()
        if ke:
            ent = ke if isinstance(ke, dict) else json.loads(ke)
            for k in ("models","companies","products"):
                for v in ent.get(k, []):
                    keys.add(normalize_entity(v))
        topics.append([tid, tname, keys, ent if ke else {}])

    new_topics = 0
    links = 0
    pending = []  # items that didn't match any topic, candidates for new topics

    for it in items:
        ekey = cluster_key(it.get("entities"))
        if not ekey:
            continue
        # find best overlap among existing topics
        best = None; best_overlap = 0
        for t in topics:
            ov = len(ekey & t[2])
            if ov >= 1 and ov > best_overlap:
                best, best_overlap = t, ov
        if best:
            cur.execute("INSERT INTO item_topics(item_id,topic_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",
                        (it["id"], best[0]))
            if cur.rowcount: links += 1
            cur.execute("UPDATE topics SET last_active_at=NOW() WHERE id=%s", (best[0],))
        else:
            pending.append((it, ekey))

    # greedy clustering for pending
    pending = list(pending)
    while pending:
        seed_it, seed_keys = max(pending, key=lambda p: len(p[1]))
        cluster = [(seed_it, seed_keys)]
        rest = []
        for p in pending:
            if p is (seed_it, seed_keys): continue
            it2, k2 = p
            if it2["id"] == seed_it["id"]: continue
            if len(seed_keys & k2) >= 1:
                cluster.append(p)
            else:
                rest.append(p)
        if len(cluster) >= 2:
            # create topic via Kimi naming
            topic_meta = name_topic([c[0] for c in cluster])
            if topic_meta:
                cur.execute(
                  "INSERT INTO topics(name, summary, key_entities) VALUES(%s,%s,%s::jsonb) RETURNING id",
                  (topic_meta["name"], topic_meta.get("summary"),
                   json.dumps({"models": topic_meta.get("key_entities", []), "companies": [], "products": []})))
                tid = cur.fetchone()[0]
                # store key_entities including all collected dimensions
                merged = {"models": [], "companies": [], "products": [], "people": [], "topics": []}
                for c, _ in cluster:
                    e = c.get("entities") or {}
                    for k in merged:
                        for v in e.get(k, []):
                            if v not in merged[k]:
                                merged[k].append(v)
                cur.execute("UPDATE topics SET key_entities=%s::jsonb WHERE id=%s",
                            (json.dumps(merged), tid))
                new_topics += 1
                for c, _ in cluster:
                    cur.execute("INSERT INTO item_topics(item_id,topic_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",
                                (c["id"], tid))
                    if cur.rowcount: links += 1
                # add to in-memory list so subsequent matches can hit
                tkeys = set()
                for k in ("models","companies","products"):
                    for v in merged[k]:
                        tkeys.add(normalize_entity(v))
                topics.append([tid, topic_meta["name"], tkeys, merged])
        pending = [p for p in rest]
        # safety: avoid infinite loop on degenerate input
        if not cluster or len(cluster) < 2:
            break
    con.commit()
    return new_topics, links

def name_topic(items):
    """Ask Kimi for {name, summary, key_entities} given items in cluster."""
    listing = "\n".join(
        f"[{i+1}] [{it['source']}{(' '+it['sub_or_handle']) if it.get('sub_or_handle') else ''}] {it['title']}"
        + (f"\n    {(it.get('body') or '')[:200]}" if it.get('body') else "")
        for i, it in enumerate(items[:10])
    )
    prompt = (
        "以下是关于同一 AI 话题的内容。请：\n"
        "1. 给一个简短中文主题名（≤10 字，名词性，准确具体如 \"GPT-5 发布\"）\n"
        "2. 写 2-3 句中文摘要（核心事件 + 各方观点要点）\n"
        "3. 列 3-5 个核心实体（模型/产品/公司/人）\n"
        "返回严格 JSON：{\"name\":\"...\",\"summary\":\"...\",\"key_entities\":[\"...\"]}\n\n"
        f"内容列表：\n{listing}"
    )
    try:
        out = kimi([{"role":"user","content":prompt}],
                   response_format={"type":"json_object"}, max_tokens=400)
        data = extract_json(out)
        if isinstance(data, dict) and data.get("name"):
            return data
    except Exception as e:
        print(f"[name] failed: {e}", file=sys.stderr)
    return None

def refresh_topic_stats(con):
    """Recompute item_count, source_count, total_score, is_hot, is_rising."""
    cur = con.cursor()
    cur.execute("""
        UPDATE topics t SET
          item_count   = sub.cnt,
          source_count = sub.scount,
          total_score  = sub.tscore,
          last_active_at = COALESCE(sub.last_active, t.last_active_at)
        FROM (
          SELECT it.topic_id,
                 COUNT(*)            AS cnt,
                 COUNT(DISTINCT i.source) AS scount,
                 COALESCE(SUM(i.score),0) AS tscore,
                 MAX(i.published_at) AS last_active
          FROM item_topics it JOIN items i ON i.id=it.item_id
          WHERE i.published_at > NOW() - INTERVAL '3 days'
          GROUP BY it.topic_id
        ) sub
        WHERE t.id = sub.topic_id AND t.archived_at IS NULL
    """)
    # is_rising: created within 12h AND ≥3 items
    cur.execute("""
        UPDATE topics SET is_rising = (first_seen_at >= NOW() - INTERVAL '12 hours' AND item_count >= 3)
         WHERE archived_at IS NULL
    """)
    # is_hot: source_count>=2 AND total_score in top 30%
    cur.execute("""
        WITH ranked AS (
          SELECT id, total_score,
                 PERCENT_RANK() OVER (ORDER BY total_score DESC) AS pr
            FROM topics WHERE archived_at IS NULL
        )
        UPDATE topics t SET is_hot = (
          t.source_count >= 2 AND COALESCE(r.pr, 1) <= 0.30
        )
        FROM ranked r WHERE r.id = t.id
    """)
    con.commit()

def main():
    with psycopg.connect(**pg_config(), autocommit=False) as con:
        cur = con.cursor()
        # Pull items needing relevance/entities work, prioritize unprocessed first
        cur.execute("""
          SELECT id, source, source_id, title, body, post_url, link_url, author,
                 sub_or_handle, score, published_at, is_ai_relevant, entities
          FROM items
          WHERE (is_ai_relevant IS NULL)
             OR (is_ai_relevant = TRUE AND entities IS NULL)
          ORDER BY fetched_at DESC LIMIT 200
        """)
        cols = [c.name for c in cur.description]
        items = [dict(zip(cols, r)) for r in cur.fetchall()]
        print(f"[enrich] {len(items)} items pending")

        # Step 1: classify HN where is_ai_relevant IS NULL
        hn_items = [it for it in items if it["source"]=="hn" and it["is_ai_relevant"] is None]
        if hn_items:
            print(f"[classify] {len(hn_items)} HN items")
            classify_hn_relevance(hn_items)

        # Reddit/X with NULL relevance default to True (sub/handle pre-filtered)
        for it in items:
            if it["is_ai_relevant"] is None and it["source"] in ("reddit","x"):
                it["is_ai_relevant"] = True

        # write back is_ai_relevant for items that just got classified
        for it in items:
            if it["is_ai_relevant"] is not None:
                cur.execute("UPDATE items SET is_ai_relevant=%s WHERE id=%s",
                            (it["is_ai_relevant"], it["id"]))
        con.commit()

        # Step 2: entities for AI-relevant items missing entities
        need_entities = [it for it in items if it["is_ai_relevant"] and not it["entities"]]
        if need_entities:
            print(f"[entities] {len(need_entities)} items")
            extract_entities(need_entities)
            for it in need_entities:
                if it.get("entities"):
                    cur.execute("UPDATE items SET entities=%s::jsonb WHERE id=%s",
                                (json.dumps(it["entities"]), it["id"]))
            con.commit()

        # Step 3: cluster into topics (use ALL items with entities, not just newly enriched)
        cur.execute("""
          SELECT i.id, i.source, i.title, i.body, i.score, i.published_at, i.entities, i.sub_or_handle
            FROM items i
            LEFT JOIN item_topics it ON it.item_id = i.id
           WHERE i.is_ai_relevant = TRUE AND i.entities IS NOT NULL AND it.item_id IS NULL
           ORDER BY i.published_at DESC LIMIT 300
        """)
        cols2 = [c.name for c in cur.description]
        unassigned = [dict(zip(cols2, r)) for r in cur.fetchall()]
        print(f"[cluster] {len(unassigned)} items unassigned")
        new_topics, links = assign_topics(con, unassigned)
        print(f"[cluster] +{new_topics} topics, +{links} links")

        # Step 4: refresh hot/rising flags + counts
        refresh_topic_stats(con)
        cur.execute("SELECT COUNT(*), SUM(CASE WHEN is_hot THEN 1 ELSE 0 END), SUM(CASE WHEN is_rising THEN 1 ELSE 0 END) FROM topics WHERE archived_at IS NULL")
        total, hot, rising = cur.fetchone()
        print(f"[done] active topics: {total} (hot={hot or 0}, rising={rising or 0})")

if __name__ == "__main__":
    main()
