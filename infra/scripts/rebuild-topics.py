#!/usr/bin/env python3
"""按同一事件边界重建 topics 和 item_topics。

这个脚本用于修复历史数据：它不会重新抓取内容，也不会重新抽取实体，只读取
items.entities，并让模型按“同一个事件/进展/讨论焦点”重新分组。
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime

import psycopg

API_KEY = os.environ.get("AI_API_KEY") or os.environ["MOONSHOT_API_KEY"]
API_URL = os.environ.get("AI_API_URL") or os.environ.get("MOONSHOT_API_URL", "https://api.deepseek.com/chat/completions")
MODEL = os.environ.get("AI_MODEL") or os.environ.get("MOONSHOT_MODEL", "deepseek-v4-flash")
AI_THINKING = os.environ.get("AI_THINKING") or ("disabled" if "deepseek.com" in API_URL else "")

ENTITY_FIELDS = ("models", "people", "companies", "products", "topics")
IDENTITY_FIELDS = ("models", "companies", "products")
BROAD_ENTITY_KEYS = {
    "ai", "ml", "llm", "llms", "model", "models", "agent", "agents",
    "openai", "anthropic", "google", "googledeepmind", "deepmind",
    "microsoft", "meta", "amazon", "aws", "xai", "deepseek", "qwen",
    "claude", "chatgpt", "codex", "gemini", "kimi",
}


@dataclass
class TopicDraft:
    """内存里的待写入 topic，先用临时 id 串联批次，再统一落库。"""

    temp_id: int
    name: str
    summary: str
    key_entities: dict[str, list[str]]
    item_ids: list[int] = field(default_factory=list)


def pg_config():
    """从环境变量读取 Postgres 连接参数，兼容本地隧道和远端直接运行。"""
    return {
        key: value
        for key, value in {
            "dbname": os.environ.get("PGDATABASE"),
            "user": os.environ.get("PGUSER"),
            "host": os.environ.get("PGHOST"),
            "port": os.environ.get("PGPORT"),
            "password": os.environ.get("PGPASSWORD"),
            "sslmode": os.environ.get("PGSSL"),
        }.items()
        if value
    }


def kimi(messages, max_tokens=3000, retries=2):
    """调用 Kimi，并统一要求返回 JSON 对象。"""
    payload = {
        "model": MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    if AI_THINKING:
        payload["thinking"] = {"type": AI_THINKING}
    body = json.dumps(payload, ensure_ascii=False).encode()
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(
                API_URL,
                data=body,
                headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read())
                content = data["choices"][0]["message"].get("content")
                if not content:
                    raise ValueError("empty model content")
                return content
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"kimi call failed: {last_err}")


def extract_json(text):
    """从模型响应里提取 JSON，兼容偶发的 Markdown 代码块。"""
    text = str(text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:
        match = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
        if match:
            return json.loads(match.group(1))
    raise ValueError(f"no JSON in response: {text[:200]}")


def normalize_text(value, limit):
    """收口模型返回的展示文本，避免空白和超长内容进入数据库。"""
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def normalize_entity(value):
    """把实体转成可比较 key，用于候选 topic 召回，不用于直接判定归并。"""
    return re.sub(r"[\s\-_/]+", "", str(value or "").lower())


def normalize_list(value, limit=12):
    """清洗模型或数据库里的数组字段，保留顺序并去重。"""
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        text = normalize_text(item, 80)
        if text and text not in result:
            result.append(text)
    return result[:limit]


def clean_item_ids(values, valid_ids):
    """清洗模型返回的 item_ids，忽略非数字、越界和重复 id。"""
    result = []
    for value in values if isinstance(values, list) else []:
        try:
            item_id = int(value)
        except Exception:
            continue
        if item_id in valid_ids and item_id not in result:
            result.append(item_id)
    return result


def safe_int(value):
    """把模型返回的数字字段安全转成 int，失败时返回 None。"""
    try:
        return int(value)
    except Exception:
        return None


def safe_float(value):
    """把模型返回的置信度安全转成 float，失败时按 0 处理。"""
    try:
        return float(value)
    except Exception:
        return 0.0


def normalize_entities(value):
    """统一实体 JSON 形状，避免缺字段影响后续聚类。"""
    raw = value if isinstance(value, dict) else {}
    return {field_name: normalize_list(raw.get(field_name), 16) for field_name in ENTITY_FIELDS}


def merge_entities(items, extra=None):
    """合并一个 topic 内所有文章的实体，作为后续召回和展示依据。"""
    merged = {field_name: [] for field_name in ENTITY_FIELDS}

    def add(field_name, value):
        text = normalize_text(value, 80)
        if text and text not in merged[field_name]:
            merged[field_name].append(text)

    for value in extra or []:
        add("models", value)
    for item in items:
        entities = normalize_entities(item.get("entities"))
        for field_name in ENTITY_FIELDS:
            for value in entities[field_name]:
                add(field_name, value)
    return {field_name: values[:16] for field_name, values in merged.items()}


def identity_keys_from_entities(entities):
    """提取用于召回候选的模型/公司/产品 key；宽泛实体会被降权。"""
    keys = set()
    for field_name in IDENTITY_FIELDS:
        for value in normalize_entities(entities).get(field_name, []):
            key = normalize_entity(value)
            if len(key) >= 2:
                keys.add(key)
    return keys


def specific_identity_keys(entities):
    """只保留足够具体的实体 key，避免 OpenAI/LLM 这类词把主题粘住。"""
    return {key for key in identity_keys_from_entities(entities) if key not in BROAD_ENTITY_KEYS}


def load_items(con, days=None, max_items=None):
    """读取需要重建 topic 的历史文章，默认覆盖全部已有 AI 相关实体数据。"""
    clauses = ["is_ai_relevant = TRUE", "entities IS NOT NULL"]
    params = []
    if days:
        clauses.append("published_at > NOW() - (%s::text || ' days')::interval")
        params.append(days)
    limit_sql = " LIMIT %s" if max_items else ""
    if max_items:
        params.append(max_items)
    sql = f"""
      SELECT id, source, title, body, sub_or_handle, score, published_at, entities
        FROM items
       WHERE {' AND '.join(clauses)}
       ORDER BY published_at ASC
       {limit_sql}
    """
    cur = con.cursor()
    cur.execute(sql, params)
    cols = [c.name for c in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    for row in rows:
        row["entities"] = normalize_entities(row.get("entities"))
    return rows


def item_payload(item):
    """构造给模型看的文章摘要，控制上下文长度。"""
    return {
        "id": item["id"],
        "source": item["source"],
        "title": normalize_text(item.get("title"), 180),
        "body": normalize_text(item.get("body"), 260),
        "sub_or_handle": item.get("sub_or_handle"),
        "score": int(item.get("score") or 0),
        "published_at": str(item.get("published_at")),
        "entities": item.get("entities") or {},
    }


def topic_payload(topic, items_by_id):
    """构造已有候选 topic 的上下文，用最近文章帮助模型判断边界。"""
    recent_ids = topic.item_ids[-4:]
    return {
        "id": topic.temp_id,
        "name": topic.name,
        "summary": normalize_text(topic.summary, 260),
        "key_entities": topic.key_entities,
        "recent_items": [item_payload(items_by_id[item_id]) for item_id in recent_ids if item_id in items_by_id],
    }


def select_candidate_topics(batch, topics):
    """按实体重叠召回候选 topic；最终是否归并仍交给同事件判断。"""
    batch_keys = set()
    batch_specific_keys = set()
    for item in batch:
        batch_keys |= identity_keys_from_entities(item.get("entities"))
        batch_specific_keys |= specific_identity_keys(item.get("entities"))

    scored = []
    for topic in topics:
        topic_keys = identity_keys_from_entities(topic.key_entities)
        topic_specific_keys = {key for key in topic_keys if key not in BROAD_ENTITY_KEYS}
        score = len(batch_specific_keys & topic_specific_keys) * 3 + len(batch_keys & topic_keys)
        if score > 0:
            scored.append((score, topic))

    scored.sort(key=lambda pair: (pair[0], len(pair[1].item_ids)), reverse=True)
    # 候选 topic 只用于召回，过多会拖慢模型并增加误归并概率。
    selected = [topic for _, topic in scored[:24]]
    recent = topics[-8:]
    for topic in recent:
        if topic not in selected:
            selected.append(topic)
    return selected[:32]


def build_cluster_prompt(batch, candidates, items_by_id):
    """生成批量聚类提示词，明确 topic 不是实体桶，而是同一事件。"""
    return [
        {
            "role": "system",
            "content": "你只输出可解析 JSON，不输出 Markdown。",
        },
        {
            "role": "user",
            "content": "\n".join(
                [
                    "你是 AI 新闻主题重建器。请把文章归入已有 topic 或创建新 topic。",
                    "",
                    "topic 的定义：同一个主对象（模型/产品/公司/项目）下，相近讨论角度的一组文章。",
                    "相近讨论角度可以合并：发布/上线/API/第三方平台可用；功能/产品集成；价格/成本；能力评测/benchmark/实测；问题/漏洞/安全风险/异常/幻觉/稳定性/系统卡/bug bounty；融资/合作/商业协议；部署/硬件/性能；社区工具/插件。",
                    "禁止把 topic 当成纯实体桶：仅共享公司/模型/产品/宽泛技术词，但讨论角度完全不同，不能合并。",
                    "也不要过度拆碎：同一主对象 + 同一讨论角度要放在一起。",
                    "例子：GPT-5.5 的幻觉、系统卡矛盾、卡死、聊天记录异常、生物安全漏洞赏金、网络安全测试，都属于 GPT-5.5 问题与风险反馈。",
                    "例子：DeepSeek V4 发布、DeepSeek V4 价格折扣、DeepSeek V4 部署硬件/KV cache 可以分开，因为讨论角度不同。",
                    "例子：GPT-Image 2 实测不能和 GPT-5.5 文本模型发布合并，即使都来自 OpenAI。",
                    "",
                    "规则：",
                    "1. 只有和已有 topic 属于同一主对象且讨论角度相近，才填 topic_id。",
                    "2. 新 topic 至少需要 2 条文章共享同一主对象和相近讨论角度；单条孤立文章不要创建 topic。",
                    "3. 如果只能看出共享实体，但讨论角度不同，topic_id 和 new_topic_key 都填 null。",
                    "4. confidence 表示同事件确信度；低于 0.78 的归并会被丢弃。",
                    "5. name 使用稳定中文短名，不要把过期状态固化进名称。",
                    "6. summary 只描述这些文章能证实的当前状态。",
                    "",
                    "返回严格 JSON：",
                    '{"items":[{"id":1,"topic_id":10,"new_topic_key":null,"confidence":0.92},{"id":2,"topic_id":null,"new_topic_key":"n1","confidence":0.9}],"new_topics":[{"key":"n1","name":"稳定中文主题名","summary":"1-2句中文摘要","key_entities":["核心实体"],"item_ids":[2,3]}]}',
                    "",
                    "已有候选 topics：",
                    json.dumps([topic_payload(topic, items_by_id) for topic in candidates], ensure_ascii=False),
                    "",
                    "待分组文章：",
                    json.dumps([item_payload(item) for item in batch], ensure_ascii=False),
                ]
            ),
        },
    ]


def cluster_batch(batch, topics, items_by_id):
    """让模型处理一个批次，并返回清洗后的归并结果。"""
    candidates = select_candidate_topics(batch, topics)
    data = extract_json(kimi(build_cluster_prompt(batch, candidates, items_by_id), max_tokens=4500))
    valid_item_ids = {item["id"] for item in batch}
    valid_topic_ids = {topic.temp_id for topic in candidates}

    assignments = []
    for item in data.get("items", []) if isinstance(data, dict) else []:
        item_id = safe_int(item.get("id"))
        if item_id not in valid_item_ids:
            continue
        confidence = safe_float(item.get("confidence") or 0)
        topic_id = safe_int(item.get("topic_id"))
        new_topic_key = normalize_text(item.get("new_topic_key"), 40) or None
        if topic_id not in valid_topic_ids:
            topic_id = None
        if topic_id and confidence < 0.78:
            topic_id = None
        assignments.append({
            "item_id": item_id,
            "topic_id": topic_id,
            "new_topic_key": new_topic_key,
            "confidence": confidence,
        })

    new_topics = []
    for topic in data.get("new_topics", []) if isinstance(data, dict) else []:
        key = normalize_text(topic.get("key"), 40)
        name = normalize_text(topic.get("name"), 40)
        item_ids = clean_item_ids(topic.get("item_ids"), valid_item_ids)
        if key and name and len(item_ids) >= 2:
            new_topics.append({
                "key": key,
                "name": name,
                "summary": normalize_text(topic.get("summary"), 800),
                "key_entities": normalize_list(topic.get("key_entities"), 10),
                "item_ids": item_ids,
            })
    return assignments, new_topics


def add_items_to_topic(topic, item_ids, items_by_id):
    """把文章挂到内存 topic 上，并刷新聚合实体。"""
    for item_id in item_ids:
        if item_id in items_by_id and item_id not in topic.item_ids:
            topic.item_ids.append(item_id)
    topic_items = [items_by_id[item_id] for item_id in topic.item_ids if item_id in items_by_id]
    topic.key_entities = merge_entities(topic_items, topic.key_entities.get("models", []))


def apply_batch_result(assignments, new_topics, topics, items_by_id, next_topic_id):
    """把一个批次的模型结果合并到内存 topic 列表。"""
    topic_by_id = {topic.temp_id: topic for topic in topics}
    assigned = set()
    key_to_items = {}

    for assignment in assignments:
        item_id = assignment["item_id"]
        if assignment["topic_id"] and assignment["topic_id"] in topic_by_id:
            add_items_to_topic(topic_by_id[assignment["topic_id"]], [item_id], items_by_id)
            assigned.add(item_id)
        elif assignment["new_topic_key"]:
            key_to_items.setdefault(assignment["new_topic_key"], set()).add(item_id)

    for topic in new_topics:
        item_ids = set(topic["item_ids"]) | key_to_items.get(topic["key"], set())
        item_ids = [item_id for item_id in item_ids if item_id not in assigned]
        if len(item_ids) < 2:
            continue

        topic_items = [items_by_id[item_id] for item_id in item_ids if item_id in items_by_id]
        draft = TopicDraft(
            temp_id=next_topic_id,
            name=topic["name"],
            summary=topic["summary"],
            key_entities=merge_entities(topic_items, topic["key_entities"]),
            item_ids=list(item_ids),
        )
        topics.append(draft)
        assigned.update(item_ids)
        next_topic_id += 1
    return next_topic_id


def build_split_prompt(topic, topic_items):
    """生成拆分提示词，用于复核过大的 topic 是否混杂。"""
    return [
        {"role": "system", "content": "你只输出可解析 JSON，不输出 Markdown。"},
        {
            "role": "user",
            "content": "\n".join(
                [
                    "下面这个 topic 可能混入了多个不同讨论角度。请按同一主对象 + 相近讨论角度重新拆分。",
                    "不要因为共享公司、模型、产品或 LLM/AI 等宽泛词而放在同组。",
                    "但不要过度拆碎：问题、漏洞、安全风险、异常、幻觉、稳定性、系统卡矛盾、bug bounty 都可以作为同一个“问题与风险反馈”角度。",
                    "如果同一模型下同时出现发布、API 接入、价格/折扣、能力评测、部署/硬件/KV cache、问题反馈，则按这些讨论角度拆分。",
                    "只有所有文章都在讲同一主对象且讨论角度相近时，才允许返回一个 group。",
                    "每个 group 至少 2 条文章；单条孤立文章丢到 ungrouped_item_ids。",
                    "",
                    "返回严格 JSON：",
                    '{"groups":[{"name":"稳定中文主题名","summary":"1-2句中文摘要","key_entities":["核心实体"],"item_ids":[1,2]}],"ungrouped_item_ids":[3]}',
                    "",
                    "原 topic：",
                    json.dumps({
                        "name": topic.name,
                        "summary": topic.summary,
                        "key_entities": topic.key_entities,
                    }, ensure_ascii=False),
                    "",
                    "文章：",
                    json.dumps([item_payload(item) for item in topic_items], ensure_ascii=False),
                ]
            ),
        },
    ]


def topic_needs_review(topic, items_by_id):
    """判断 topic 是否需要二次拆分，重点抓实体高度发散的大 topic。"""
    topic_items = [items_by_id[item_id] for item_id in topic.item_ids if item_id in items_by_id]
    keys = set()
    for item in topic_items:
        keys |= identity_keys_from_entities(item.get("entities"))
    return len(topic_items) >= 8 or (len(topic_items) >= 4 and len(keys) >= len(topic_items) * 2)


def split_mixed_topics(topics, items_by_id):
    """对疑似混杂的大 topic 做二次拆分，修掉实体桶式合并。"""
    refined = []
    next_topic_id = max((topic.temp_id for topic in topics), default=0) + 1
    for topic in topics:
        if not topic_needs_review(topic, items_by_id):
            refined.append(topic)
            continue

        topic_items = [items_by_id[item_id] for item_id in topic.item_ids if item_id in items_by_id]
        try:
            data = extract_json(kimi(build_split_prompt(topic, topic_items), max_tokens=5000))
        except Exception as e:
            print(f"[split] topic {topic.temp_id} failed: {e}", file=sys.stderr)
            refined.append(topic)
            continue

        groups = data.get("groups", []) if isinstance(data, dict) else []
        if len(groups) <= 1:
            refined.append(topic)
            continue

        valid_ids = {item["id"] for item in topic_items}
        used = set()
        for group in groups:
            item_ids = [item_id for item_id in clean_item_ids(group.get("item_ids"), valid_ids) if item_id not in used]
            if len(item_ids) < 2:
                continue
            group_items = [items_by_id[item_id] for item_id in item_ids]
            refined.append(TopicDraft(
                temp_id=next_topic_id,
                name=normalize_text(group.get("name"), 40) or topic.name,
                summary=normalize_text(group.get("summary"), 800) or topic.summary,
                key_entities=merge_entities(group_items, normalize_list(group.get("key_entities"), 10)),
                item_ids=item_ids,
            ))
            used.update(item_ids)
            next_topic_id += 1
    return refined


def topic_merge_payload(topic, items_by_id):
    """构造 topic 合并复核所需的轻量上下文。"""
    sample_items = [items_by_id[item_id] for item_id in topic.item_ids[:6] if item_id in items_by_id]
    return {
        "id": topic.temp_id,
        "name": topic.name,
        "summary": normalize_text(topic.summary, 260),
        "key_entities": topic.key_entities,
        "item_count": len(topic.item_ids),
        "sample_titles": [normalize_text(item.get("title"), 180) for item in sample_items],
    }


def build_merge_prompt(topics, items_by_id):
    """生成相近 topic 合并提示，避免同一角度被拆成多个小 topic。"""
    return [
        {"role": "system", "content": "你只输出可解析 JSON，不输出 Markdown。"},
        {
            "role": "user",
            "content": "\n".join(
                [
                    "下面是一批已经初步拆分的 topic。请找出应该合并的 topic。",
                    "合并标准：同一个主对象（模型/产品/公司/项目）且讨论角度相近。",
                    "可以合并的相近角度：",
                    "- 发布、API 可用、第三方平台上线，属于“发布与可用性”。",
                    "- 幻觉、卡死、上下文丢失、聊天记录异常、系统卡矛盾、生物安全漏洞赏金、网络安全风险测试，属于“问题与风险反馈”。",
                    "- 基准测试、主观实测、能力评估，属于“能力评测”。",
                    "- 价格、折扣、token 效率、成本对比，属于“价格与成本”。",
                    "不要合并：仅共享 OpenAI/DeepSeek/LLM 等实体，但讨论角度不同；产品功能集成和基础模型发布也不要强行合并。",
                    "",
                    "返回严格 JSON：",
                    '{"merge_groups":[{"topic_ids":[1,2],"name":"合并后稳定中文名","reason":"同一主对象和相近讨论角度"}]}',
                    "",
                    "topics：",
                    json.dumps([topic_merge_payload(topic, items_by_id) for topic in topics], ensure_ascii=False),
                ]
            ),
        },
    ]


def merge_topic_group(group, topic_by_id, items_by_id, next_topic_id):
    """把模型指定的一组 topic 合成一个内存 topic。"""
    topic_ids = []
    for value in group.get("topic_ids", []) if isinstance(group, dict) else []:
        topic_id = safe_int(value)
        if topic_id in topic_by_id and topic_id not in topic_ids:
            topic_ids.append(topic_id)
    if len(topic_ids) < 2:
        return None

    item_ids = []
    for topic_id in topic_ids:
        for item_id in topic_by_id[topic_id].item_ids:
            if item_id not in item_ids:
                item_ids.append(item_id)
    topic_items = [items_by_id[item_id] for item_id in item_ids if item_id in items_by_id]
    name = normalize_text(group.get("name"), 40) if isinstance(group, dict) else ""
    if not name:
        name = topic_by_id[topic_ids[0]].name
    return TopicDraft(
        temp_id=next_topic_id,
        name=name,
        summary="",
        key_entities=merge_entities(topic_items),
        item_ids=item_ids,
    )


def merge_similar_topics(topics, items_by_id):
    """合并同一主对象下相近角度的小 topic，避免历史修复后过碎。"""
    if len(topics) < 2:
        return topics

    try:
        data = extract_json(kimi(build_merge_prompt(topics, items_by_id), max_tokens=3000))
    except Exception as e:
        print(f"[merge] failed: {e}", file=sys.stderr)
        return topics

    topic_by_id = {topic.temp_id: topic for topic in topics}
    used = set()
    merged = []
    next_topic_id = max(topic_by_id, default=0) + 1
    for group in data.get("merge_groups", []) if isinstance(data, dict) else []:
        candidate = merge_topic_group(group, topic_by_id, items_by_id, next_topic_id)
        if not candidate:
            continue
        group_ids = [safe_int(value) for value in group.get("topic_ids", [])]
        group_ids = [topic_id for topic_id in group_ids if topic_id in topic_by_id]
        if any(topic_id in used for topic_id in group_ids):
            continue
        merged.append(candidate)
        used.update(group_ids)
        next_topic_id += 1

    for topic in topics:
        if topic.temp_id not in used:
            merged.append(topic)
    return merged


def summarize_topic(topic, items_by_id):
    """基于最终分组重新生成 topic 名称、摘要和核心实体。"""
    topic_items = [items_by_id[item_id] for item_id in topic.item_ids if item_id in items_by_id]
    prompt = [
        {"role": "system", "content": "你只输出可解析 JSON，不输出 Markdown。"},
        {
            "role": "user",
            "content": "\n".join(
                [
                    "请为以下同一 topic 的文章生成最终元数据。",
                    "name 使用稳定中文短名；summary 用 1-2 句中文描述这些文章能证实的当前状态。",
                    "不要把过期状态说成当前状态。返回严格 JSON：",
                    '{"name":"稳定中文主题名","summary":"1-2句中文摘要","key_entities":["核心实体"]}',
                    "",
                    json.dumps([item_payload(item) for item in topic_items[:16]], ensure_ascii=False),
                ]
            ),
        },
    ]
    try:
        data = extract_json(kimi(prompt, max_tokens=800))
    except Exception as e:
        print(f"[summary] topic {topic.temp_id} failed: {e}", file=sys.stderr)
        return topic

    topic.name = normalize_text(data.get("name"), 40) or topic.name
    topic.summary = normalize_text(data.get("summary"), 800) or topic.summary
    topic.key_entities = merge_entities(topic_items, normalize_list(data.get("key_entities"), 10))
    return topic


def rebuild_topics(items, batch_size, strict=False):
    """主重建流程：批量聚类、二次拆分、最终摘要。"""
    topics = []
    items_by_id = {item["id"]: item for item in items}
    next_topic_id = 1

    for start in range(0, len(items), batch_size):
        batch = items[start:start + batch_size]
        print(f"[cluster] batch {start + 1}-{start + len(batch)} / {len(items)}", flush=True)
        try:
            assignments, new_topics = cluster_batch(batch, topics, items_by_id)
        except Exception as e:
            print(f"[cluster] batch failed: {e}", file=sys.stderr)
            if strict:
                raise
            continue
        next_topic_id = apply_batch_result(assignments, new_topics, topics, items_by_id, next_topic_id)

    topics = [topic for topic in topics if len(topic.item_ids) >= 2]
    print(f"[split] reviewing {len(topics)} topics", flush=True)
    topics = split_mixed_topics(topics, items_by_id)
    print(f"[merge] reviewing {len(topics)} topics", flush=True)
    topics = merge_similar_topics(topics, items_by_id)

    final_topics = []
    for index, topic in enumerate(topics, 1):
        if len(topic.item_ids) < 2:
            continue
        print(f"[summary] {index}/{len(topics)} {topic.name} ({len(topic.item_ids)})", flush=True)
        final_topics.append(summarize_topic(topic, items_by_id))
    return final_topics


def refresh_topic_stats(cur):
    """按现有线上规则刷新 topic 计数、热度和上升标记。"""
    cur.execute("""
        UPDATE topics t SET
          item_count = sub.cnt,
          source_count = sub.scount,
          total_score = sub.tscore,
          last_active_at = COALESCE(sub.last_active, t.last_active_at)
        FROM (
          SELECT it.topic_id,
                 COUNT(*) AS cnt,
                 COUNT(DISTINCT i.source) AS scount,
                 COALESCE(SUM(i.score), 0) AS tscore,
                 MAX(i.published_at) AS last_active
            FROM item_topics it
            JOIN items i ON i.id = it.item_id
           WHERE i.published_at > NOW() - INTERVAL '3 days'
           GROUP BY it.topic_id
        ) sub
        WHERE t.id = sub.topic_id AND t.archived_at IS NULL
    """)
    cur.execute("""
        UPDATE topics
           SET item_count = 0, source_count = 0, total_score = 0
         WHERE archived_at IS NULL
           AND id NOT IN (SELECT DISTINCT topic_id FROM item_topics)
    """)
    cur.execute("""
        UPDATE topics
           SET is_rising = (first_seen_at >= NOW() - INTERVAL '12 hours' AND item_count >= 3)
         WHERE archived_at IS NULL
    """)
    cur.execute("""
        WITH ranked AS (
          SELECT id, total_score,
                 PERCENT_RANK() OVER (ORDER BY total_score DESC) AS pr
            FROM topics
           WHERE archived_at IS NULL
        )
        UPDATE topics t SET is_hot = (
          t.source_count >= 2 AND COALESCE(ranked.pr, 1) <= 0.30
        )
        FROM ranked
        WHERE ranked.id = t.id
    """)


def apply_rebuild(con, topics, items_by_id):
    """归档旧 active topic，删除旧链接，再写入重建后的 active topics。"""
    cur = con.cursor()
    cur.execute("SELECT id FROM topics WHERE archived_at IS NULL")
    old_topic_ids = [row[0] for row in cur.fetchall()]
    if old_topic_ids:
        cur.execute("DELETE FROM item_topics WHERE topic_id = ANY(%s)", (old_topic_ids,))
        cur.execute("UPDATE topics SET archived_at = NOW() WHERE id = ANY(%s)", (old_topic_ids,))

    for topic in topics:
        topic_items = [items_by_id[item_id] for item_id in topic.item_ids if item_id in items_by_id]
        if len(topic_items) < 2:
            continue
        first_seen = min(item["published_at"] for item in topic_items)
        last_active = max(item["published_at"] for item in topic_items)
        cur.execute("""
          INSERT INTO topics(name, summary, key_entities, first_seen_at, last_active_at)
          VALUES(%s, %s, %s::jsonb, %s, %s)
          RETURNING id
        """, (
            topic.name,
            topic.summary,
            json.dumps(topic.key_entities, ensure_ascii=False),
            first_seen,
            last_active,
        ))
        topic_id = cur.fetchone()[0]
        cur.executemany(
            "INSERT INTO item_topics(item_id, topic_id) VALUES(%s, %s) ON CONFLICT DO NOTHING",
            [(item_id, topic_id) for item_id in topic.item_ids],
        )

    refresh_topic_stats(cur)
    con.commit()


def print_preview(topics, items_by_id, limit=40):
    """输出 dry-run 预览，便于人工核对主题边界。"""
    print(f"[preview] rebuilt topics: {len(topics)}")
    for topic in sorted(topics, key=lambda value: len(value.item_ids), reverse=True)[:limit]:
        print(f"\n## {topic.name} ({len(topic.item_ids)})")
        if topic.summary:
            print(topic.summary)
        for item_id in topic.item_ids[:6]:
            item = items_by_id[item_id]
            print(f"- [{item['source']}] {item['title'][:180]}")


def parse_args():
    """解析命令行参数，默认 dry-run，显式 --apply 才写数据库。"""
    parser = argparse.ArgumentParser(description="Rebuild news topics with event-level boundaries.")
    parser.add_argument("--days", type=int, default=None, help="Only rebuild items newer than N days.")
    parser.add_argument("--max-items", type=int, default=None, help="Limit item count for testing.")
    parser.add_argument("--batch-size", type=int, default=32, help="Items per model clustering batch.")
    parser.add_argument("--apply", action="store_true", help="Write rebuilt topics to database.")
    return parser.parse_args()


def main():
    """脚本入口：加载历史文章，重建 topic，并按参数决定是否落库。"""
    args = parse_args()
    started_at = datetime.now()
    with psycopg.connect(**pg_config(), autocommit=False) as con:
        items = load_items(con, days=args.days, max_items=args.max_items)
        print(f"[load] {len(items)} AI items with entities")
        topics = rebuild_topics(items, args.batch_size, strict=args.apply)
        items_by_id = {item["id"]: item for item in items}
        print_preview(topics, items_by_id)
        if args.apply:
            apply_rebuild(con, topics, items_by_id)
            print(f"[apply] wrote {len(topics)} active topics")
        else:
            con.rollback()
            print("[dry-run] no database changes; rerun with --apply to write")
    print(f"[done] elapsed {datetime.now() - started_at}")


if __name__ == "__main__":
    main()
