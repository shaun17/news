#!/usr/bin/env python3
"""One-shot ingestion: HN + Reddit + X → items table.

Mirrors n8n `ingest` workflow. Intended as a manual kick-off when n8n scheduler
hasn't fired yet. Uses PROXY env var for HN/Reddit upstream (same as RSSHub PROXY_URI).
"""
import json, os, sys, urllib.request, urllib.error, socket, ssl
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import psycopg

PROXY = os.environ.get("PROXY", "http://100.126.75.65:6152")
RSSHUB = os.environ.get("RSSHUB", "http://127.0.0.1:1200")
PG = {"dbname":"news","user":"coco"}
UA = "news-aggregator/0.1 by wenren"

def fetch(url, use_proxy=True, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    handlers = []
    if use_proxy:
        handlers.append(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
    opener = urllib.request.build_opener(*handlers)
    with opener.open(req, timeout=timeout) as resp:
        return resp.read()

def fetch_hn():
    ids = json.loads(fetch("https://hacker-news.firebaseio.com/v0/topstories.json"))[:30]
    out = []
    def one(i):
        try:
            return json.loads(fetch(f"https://hacker-news.firebaseio.com/v0/item/{i}.json"))
        except Exception as e:
            return None
    with ThreadPoolExecutor(max_workers=8) as ex:
        for j in ex.map(one, ids):
            if not j or j.get("deleted") or j.get("dead"): continue
            out.append({
              "source":"hn","source_id":str(j["id"]),
              "title": j.get("title") or "(untitled)",
              "body": j.get("text"),
              "post_url": f"https://news.ycombinator.com/item?id={j['id']}",
              "link_url": j.get("url"),
              "author": j.get("by"),
              "sub_or_handle": None,
              "score": j.get("score", 0),
              "comment_count": j.get("descendants", 0),
              "published_at": datetime.fromtimestamp(j.get("time", 0), tz=timezone.utc).isoformat(),
              "is_ai_relevant": None,
            })
    return out

def fetch_reddit():
    subs = ["LocalLLaMA","MachineLearning","singularity","OpenAI","ClaudeAI","StableDiffusion"]
    out = []
    for s in subs:
        try:
            data = json.loads(fetch(f"https://www.reddit.com/r/{s}/hot.json?limit=25"))
        except Exception as e:
            print(f"[reddit] {s} failed: {e}", file=sys.stderr); continue
        for c in data.get("data", {}).get("children", []):
            d = c.get("data") or {}
            if not d.get("id"): continue
            out.append({
              "source":"reddit","source_id":d["id"],
              "title": d.get("title") or "",
              "body": d.get("selftext") or None,
              "post_url": f"https://www.reddit.com{d.get('permalink','')}",
              "link_url": None if d.get("is_self") else d.get("url"),
              "author": d.get("author"),
              "sub_or_handle": f"r/{d.get('subreddit','')}",
              "score": d.get("ups", 0),
              "comment_count": d.get("num_comments", 0),
              "published_at": datetime.fromtimestamp(d.get("created_utc", 0), tz=timezone.utc).isoformat(),
              "is_ai_relevant": True,
            })
    return out

def fetch_x():
    import re
    from xml.etree import ElementTree as ET
    handles = ["sama","AnthropicAI","demishassabis","ylecun","karpathy","AndrewYNg",
               "_jasonwei","giffmana","swyx","simonw","jxnlco","abacaj"]
    cutoff = datetime.now(timezone.utc).timestamp() - 72*3600
    out = []
    for h in handles:
        try:
            body = fetch(f"{RSSHUB}/twitter/user/{h}", use_proxy=False).decode("utf-8", "ignore")
        except Exception as e:
            print(f"[x] {h} failed: {e}", file=sys.stderr); continue
        try:
            root = ET.fromstring(body)
        except Exception:
            continue
        for item in root.iter("item"):
            t = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            desc = (item.findtext("description") or "").strip()
            pub = item.findtext("pubDate") or ""
            guid = item.findtext("guid") or link
            try:
                ts = datetime.strptime(pub, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=timezone.utc).timestamp() if pub else datetime.now(timezone.utc).timestamp()
            except Exception:
                try:
                    ts = datetime.strptime(pub[:25], "%a, %d %b %Y %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
                except Exception:
                    ts = datetime.now(timezone.utc).timestamp()
            if ts < cutoff: continue
            plain_title = re.sub(r"<[^>]+>", "", t)[:200] or "(no title)"
            plain_body = re.sub(r"<[^>]+>", "", desc).strip()
            out.append({
              "source":"x","source_id": guid,
              "title": plain_title,
              "body": plain_body,
              "post_url": link, "link_url": None,
              "author": f"@{h}", "sub_or_handle": f"@{h}",
              "score": 0, "comment_count": None,
              "published_at": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
              "is_ai_relevant": True,
            })
    return out

def upsert(rows):
    if not rows: return 0
    sql = """
    INSERT INTO items
      (source, source_id, title, body, post_url, link_url, author, sub_or_handle,
       score, comment_count, published_at, fetched_at, is_ai_relevant)
    VALUES (%(source)s, %(source_id)s, %(title)s, %(body)s, %(post_url)s, %(link_url)s,
            %(author)s, %(sub_or_handle)s, %(score)s, %(comment_count)s, %(published_at)s,
            NOW(), %(is_ai_relevant)s)
    ON CONFLICT (source, source_id) DO UPDATE SET
      score = EXCLUDED.score,
      comment_count = EXCLUDED.comment_count,
      fetched_at = NOW()
    """
    with psycopg.connect(**PG) as con, con.cursor() as cur:
        cur.executemany(sql, rows)
        con.commit()
    return len(rows)

def main():
    all_rows = []
    print("[hn] fetching...", flush=True)
    hn = fetch_hn(); print(f"[hn] {len(hn)} items"); all_rows += hn
    print("[reddit] fetching...", flush=True)
    r = fetch_reddit(); print(f"[reddit] {len(r)} items"); all_rows += r
    print("[x] fetching...", flush=True)
    x = fetch_x(); print(f"[x] {len(x)} items"); all_rows += x
    n = upsert(all_rows)
    print(f"[done] upserted {n} rows")

if __name__ == "__main__":
    main()
