# AI 信息热点 — 设计文档

**日期**：2026-04-24
**作者**：wenren + Claude
**状态**：待实现

---

## 1. 目标

构建一个个人用的 AI 领域信息热点聚合页，从 Hacker News、Reddit、X 三个平台抓取 AI 相关的热点内容，借助 AI 做主题聚合、摘要和趋势识别，方便我（单用户）持续追踪和发现 AI 圈的最新动态。

**用户场景**：
- 一天打开多次，刷最近几小时新出现的 AI 话题（持续追踪）
- 看到当前哪些主题在跨平台被讨论、哪些在上升（趋势观察）

**非目标**（本期不做）：多用户、订阅推送、移动端优化、全文搜索、外链文章抓取、个性化推荐。

---

## 2. 架构总览

单服务器（`100.104.136.117`），所有组件本地通信。每 30 分钟一次完整流水线。

```
HN / Reddit / RSSHub-X
        ↓ (HTTP)
    n8n 工作流（采集 + AI 处理 + Webhook API）
        ↓
    Postgres（独立 database "news"）
        ↑ (HTTP)
    Next.js 前端 (port 3000)
```

**关键决策**：
- **n8n 一把梭**：采集、AI 调用、聚类、API 全部在 n8n 里完成；逻辑写在 Code 节点（JavaScript）
- **共享 Postgres 实例**：与 n8n 已有的 PG 共一台服务器，但**新建独立 database `news`** 隔离
- **新增容器**：`rsshub`（X 数据代理）、`news-web`（Next.js 前端）
- **无认证**：自用，通过 Tailscale 直连 `http://100.104.136.117:3000`
- **LLM**：Kimi (Moonshot)，OpenAI 兼容协议，n8n 用 HTTP 节点调用

---

## 3. 数据源与采集

### 3.1 数据源清单

| 来源 | 端点 | 抓取范围 | AI 相关性过滤 |
|---|---|---|---|
| Hacker News | `/topstories.json` + `/item/<id>.json` | top 30 | ✅ 需要（HN 内容混杂） |
| Reddit | `/r/<sub>/hot.json` | 各 sub 前 25 | ❌ sub 已限定 AI 主题 |
| X | RSSHub `/twitter/user/<handle>` | 近 24-72h | ❌ 已限定关注的人 |

### 3.2 Reddit 订阅 sub（6 个）

`r/LocalLLaMA`、`r/MachineLearning`、`r/singularity`、`r/OpenAI`、`r/ClaudeAI`、`r/StableDiffusion`

### 3.3 X 关注账号（12 个起步）

`@sama`、`@AnthropicAI`、`@demishassabis`、`@ylecun`、`@karpathy`、`@AndrewYNg`、`@_jasonwei`、`@giffmana`、`@swyx`、`@simonw`、`@jxnlco`、`@abacaj`

### 3.4 采集频率

每 30 分钟一次（n8n cron 触发）。三个数据源在工作流中并行抓取。

### 3.5 内容范围

只存平台原生内容（标题、正文/推文文本、链接 URL、作者、时间、原平台热度数）。**不爬外链文章正文**（推迟到 v2）。

---

## 4. 存储

### 4.1 数据库

新建 Postgres database **`news`**（与 n8n 业务库隔离），表直接放在 `public` schema。

### 4.2 表结构

#### `items`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `source` | TEXT NOT NULL | `'hn' | 'reddit' | 'x'` |
| `source_id` | TEXT NOT NULL | 原平台 id |
| `title` | TEXT NOT NULL | |
| `body` | TEXT | selftext / 推文正文 |
| `post_url` | TEXT NOT NULL | 讨论页 URL |
| `link_url` | TEXT | 外链 URL（如有） |
| `author` | TEXT | |
| `sub_or_handle` | TEXT | subreddit 或 @handle |
| `score` | INT NOT NULL DEFAULT 0 | pts/upvotes/likes 统一一列 |
| `comment_count` | INT | |
| `published_at` | TIMESTAMPTZ NOT NULL | 原平台发布时间 |
| `fetched_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |
| `is_ai_relevant` | BOOLEAN | NULL=未判定；Reddit/X 默认 TRUE |
| `entities` | JSONB | `{models, people, companies, products, topics}` |

**约束/索引**：
- `UNIQUE (source, source_id)` — 去重
- `INDEX (published_at DESC)` — 主流排序
- `INDEX (source, published_at DESC)` — 按来源筛选
- `INDEX (is_ai_relevant) WHERE is_ai_relevant = TRUE` — 部分索引

#### `topics`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `name` | TEXT NOT NULL | Kimi 生成主题名 |
| `summary` | TEXT | 2-3 句 AI 摘要 |
| `key_entities` | JSONB | 核心实体，用于聚类匹配 |
| `item_count` | INT NOT NULL DEFAULT 0 | 关联条数（缓存） |
| `source_count` | INT NOT NULL DEFAULT 0 | 跨平台数 |
| `total_score` | BIGINT NOT NULL DEFAULT 0 | 加权热度（缓存） |
| `is_hot` | BOOLEAN NOT NULL DEFAULT FALSE | 🔥 标记 |
| `is_rising` | BOOLEAN NOT NULL DEFAULT FALSE | ⏫ 标记 |
| `first_seen_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |
| `last_active_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |
| `archived_at` | TIMESTAMPTZ | 归档时间，NULL=活跃 |

**索引**：
- `INDEX (last_active_at DESC) WHERE archived_at IS NULL`
- `INDEX (is_hot) WHERE archived_at IS NULL AND is_hot = TRUE`

#### `item_topics`

| 字段 | 类型 | 说明 |
|---|---|---|
| `item_id` | BIGINT REFERENCES items(id) ON DELETE CASCADE | |
| `topic_id` | BIGINT REFERENCES topics(id) ON DELETE CASCADE | |

PK：`(item_id, topic_id)`。INDEX：`(topic_id)`。

### 4.3 数据保留

每天独立 cron 工作流：
- `items WHERE published_at < NOW() - 30 days` → DELETE
- `topics WHERE last_active_at < NOW() - 7 days AND archived_at IS NULL` → 设 `archived_at`
- `topics WHERE archived_at < NOW() - 30 days` → DELETE（关联 `item_topics` 由 CASCADE 处理）

---

## 5. AI 处理流水线

### 5.1 工作流结构

3 个核心工作流（独立可运行、独立调试）：

#### 工作流 1：`ingest`（采集）

```
Cron(*/30 min)
  → Execute Workflow（并行）
      ├── HN fetcher: HTTP topstories + item details ×30
      ├── Reddit fetcher: HTTP /r/<sub>/hot ×6
      └── X fetcher: HTTP RSSHub feeds ×12
  → 规范化为统一 item schema（Code 节点）
  → Postgres UPSERT
       INSERT ... ON CONFLICT (source, source_id)
       DO UPDATE SET score = EXCLUDED.score,
                     comment_count = EXCLUDED.comment_count,
                     fetched_at = NOW()
       RETURNING id, (xmax = 0) AS is_new
  → 收集本轮 is_new=true 的 ids
  → Trigger 工作流 2（传 item ids）
```

每个 fetcher 节点配置 **Continue On Fail**。去重靠 `(source, source_id)` 唯一索引保证幂等。
**为什么用 UPSERT 而不是 DO NOTHING**：HN/Reddit/X 上同一 item 的 score 会随时间增长，必须更新才能让 topics.total_score 反映真实热度；同时用 `xmax = 0` 区分本轮真正新增的 item（只有这些需要送进 AI 处理）。

**容错兜底**：如果工作流 1 → 2 的 trigger 失败，下一轮 ingest 不会重新处理这些 item（因为 UPSERT 不返回 is_new=true）。为防丢，工作流 2 启动时**额外查询** `WHERE is_ai_relevant IS NULL AND fetched_at > NOW() - 6h` 的 item，把它们也纳入处理。

#### 工作流 2：`enrich`（AI 处理）

```
入参: 新 item ids
  → Postgres 查出原文
  → Switch 按 source 分流
      ├── HN: HTTP → Kimi 相关性判断（batch 50）→ 过滤非 AI
      └── Reddit/X: 直通
  → 合流
  → HTTP → Kimi 实体抽取（batch 30）→ 写回 items.entities
  → Code 节点：归类决策（详见 5.2）
  → 对新建/需重生成的 topics → HTTP → Kimi 命名+摘要
  → 写回 topics
  → Code 节点：标记刷新（is_hot / is_rising）
```

**LLM 调用预算**：每轮新增约 50 items 时，约 3-5 次 Kimi 调用（每次 batch 几十条）。

#### 工作流 3：`api`（前端 webhook）

4 个独立 webhook 工作流：

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/webhook/topics?active=true` | 返回侧栏主题列表（含 🔥 / ⏫ 标记 + 计数） |
| GET | `/webhook/items?topic=<id>&limit=&offset=&since=` | 主信息流（支持主题筛选、分页） |
| GET | `/webhook/topics/:id` | 单主题详情（摘要 + 关联 items） |
| POST | `/webhook/refresh` | 手动触发工作流 1 |

每个都是 `Webhook 节点 → Postgres 查询 → Respond to Webhook`。

#### 工作流 4：`cleanup`（每日维护）

每天 4 点跑一次，执行 4.3 节的清理逻辑。

### 5.2 主题聚类算法（Code 节点 JavaScript）

**步骤 1：实体抽取**（Kimi 调用，batch 30）

Prompt 模板：
```
从以下 AI 相关内容中提取实体。每条返回严格 JSON：
{
  "models":    [...],   // 模型/算法名
  "people":    [...],   // 人名
  "companies": [...],   // 公司/组织
  "products":  [...],   // 产品/工具
  "topics":    [...]    // 抽象话题词
}
找不到任何字段就返回空数组。不要解释。
```

后续聚类只用 `models + companies + products`（具体性强、不易混淆）。`people / topics` 当辅助索引。
失败兜底：JSON 解析错则该 item 实体为空，仍入库但不会被聚类（保留为 orphan item）。

**步骤 2：归类决策**（Code 节点）

对每条新 item，计算其实体集合 `E_item` 与每个活跃 topic（`archived_at IS NULL`）的 `key_entities` 的交集：

1. 若存在 topic T 使 `|E_item ∩ T.key_entities| ≥ 2`：
   - 取重叠最大的 topic，把 item 加入
   - 更新 `T.last_active_at = NOW()`，`item_count++`
2. 否则放入"待聚类池"。本批次跑完后做贪心聚类：
   - 找池中实体最多的一条做种子
   - 把所有与种子重叠 ≥2 的 items 拉到一起，形成新 topic（如果 ≥2 条）
   - 重复直到池子里没有 ≥2 条的簇
3. 单条剩下的（singleton）→ 不建 topic，item 仍存在 items 表，前端混合流里照常显示

实体匹配大小写不敏感、去标点。**不做同义词表**（推迟到 v2）。

**步骤 3：主题命名 + 摘要**（Kimi 调用）

调用条件：
- 新建 topic：必调
- 老 topic：仅当本轮新增 item ≥ 3 且距上次摘要 ≥ 24h 才重新生成（避免主题名乱跳）

Prompt 模板：
```
以下是关于同一 AI 话题的 N 条内容（来自 HN/Reddit/X）。请：
1. 给一个简短中文主题名（≤10 字，名词性，准确具体如 "GPT-5 发布"）
2. 写 2-3 句话中文摘要（核心事件 + 各方观点要点）
3. 列出 5 个核心实体（模型/产品/公司/人）

返回 JSON：{"name":"...", "summary":"...", "key_entities":["...","..."]}

内容列表：
[1] [HN] {title}
    {body截断 200 字}
[2] [X @karpathy] {body截断 200 字}
...
```

**步骤 4：标记刷新**（Code 节点）

每轮 AI 末尾，对所有活跃 topics 重算：

```
source_count = COUNT(DISTINCT source) for items in last 3 days
total_score  = SUM(item.score)        for items in last 3 days

is_hot    = (source_count >= 2)
            AND (total_score 排在所有活跃 topics 的前 30%)

is_rising = (first_seen_at >= NOW() - 12h)
            AND (item_count >= 3)
```

跨平台分数直接相加（HN pt / Reddit upvote / X like 同权），用于排序而非绝对量。
标记是 idempotent 的——每轮全量重算。

---

## 6. 前端

### 6.1 技术栈

- Next.js 14（App Router）
- React 18 + TypeScript
- Tailwind CSS（深色主题）
- SWR（客户端数据获取）

### 6.2 路由

只有一个页面：`/`
- `?topic=<id>` 触发主题筛选视图
- `?source=hn|reddit|x` 可选的来源筛选（次要）

URL search params 是筛选状态的**唯一来源**——可分享链接、浏览器前进后退正常。

### 6.3 API Routes（代理到 n8n webhook）

| 方法 | Next.js 路径 | 转发目标 |
|---|---|---|
| GET | `/api/topics` | `n8n /webhook/topics` |
| GET | `/api/items` | `n8n /webhook/items` |
| GET | `/api/topics/:id` | `n8n /webhook/topics/:id` |
| POST | `/api/refresh` | `n8n /webhook/refresh` |

API route 仅做透传 + 错误格式统一。前端永远只调 `/api/*`，不直接碰 n8n（避免泄露 webhook URL）。

### 6.4 组件树

```
app/layout.tsx              [Server] — 全局布局、字体
app/page.tsx                [Server] — 首屏 SSR：拿初始 topics + items
└── <HomeClient>            [Client]
    ├── <TopBar>
    │   └── <RefreshButton> — POST /api/refresh
    ├── <TopicSidebar>      — SWR /api/topics
    │   ├── <TopicGroup title="本周主题">
    │   │   └── <TopicItem>  — 含 🔥 标识、计数、active 高亮
    │   └── <TopicGroup title="上升中">
    │       └── <TopicItem>
    └── <ItemFeed>          — SWR /api/items?topic=...
        ├── <FilterBar>      — 仅 topic 筛选时显示：摘要 + × 清除
        ├── <ItemCard>       — source 徽标 + 标题 + 时间 + 平台原生热度
        └── <LoadMoreButton> — offset 累加
```

### 6.5 数据获取策略

| 场景 | 行为 |
|---|---|
| 首屏 | SSR 直接 fetch /api/topics + /api/items（first page） |
| 切换主题 | URL 变 → SWR key 变 → 自动重取 |
| 点击刷新 | POST /api/refresh → 200 表示"已触发"（n8n 异步执行）→ 立即 mutate 看现有数据；新数据通常 30-90s 后到，靠 5 分钟轮询自然出现，或用户再次点刷新 |
| 后台轮询 | SWR `refreshInterval: 5 分钟` |
| 错误 | API route 统一返回 `{error: "..."}`，前端显示 banner，不崩 |

### 6.6 关键状态

| 状态 | 表现 |
|---|---|
| 加载中 | 骨架屏：侧栏 5 条占位，主区 3 张卡片占位 |
| 正常 | 默认混合流；筛选时上方有 FilterBar |
| 空数据 | "近期还没有 AI 热点（n8n 工作流可能还没跑完）" + 刷新按钮 |
| API 错误 | 顶部红条 "无法连接到后端 (点击重试)"，仍显示上次缓存 |

### 6.7 视觉规范要点

- 来源徽标颜色：HN 橙、Reddit 绿、X 红
- 🔥 标记仅在主题旁（不再标注每条 item 的 3 天热度）
- 主题筛选只筛主题、不限时间
- 桌面优先，移动端凑合可用即可

---

## 7. 错误处理（按层）

| 层 | 错误 | 处理 |
|---|---|---|
| n8n fetcher | HN/Reddit/RSSHub 抓取失败 | `Continue On Fail`，单源挂掉不影响其他；记 n8n 执行日志 |
| Kimi 调用 | 超时/限流/JSON 解析失败 | n8n 内置重试 2 次（指数退避）；仍失败则该 item 跳过 AI 步骤、原文照常入库 |
| Code 节点 | JS 抛错 | 工作流失败状态，n8n UI 可见；按 item 处理时 try/catch 单条失败不阻塞 batch |
| Postgres | 连接断/写冲突 | INSERT ON CONFLICT DO NOTHING 解决幂等；连接断由 n8n 重试机制处理 |
| Webhook API | 查询失败 | 统一返回 `{"error": "..."}` + 5xx；前端 SWR 显示 banner |
| 前端 | API 不可达 | 顶部红条 "无法连接到后端 (点击重试)"；不白屏 |

---

## 8. 测试与可观测性

### 8.1 测试策略

考虑到所有逻辑都在 n8n 工作流里（用户选择 B），不引入独立 Python 测试框架。

| 内容 | 方法 |
|---|---|
| n8n 工作流 | n8n UI 的 manual run（用 sample 数据触发各节点，看输出） |
| Webhook 接口 | 手写 curl 脚本，触发 4 个 endpoint 验证响应结构 |
| Postgres schema | migration SQL 脚本，CI 跑 up/down 验证 |
| 前端组件 | React Testing Library 测关键交互（点击侧栏切换 URL、筛选 bar 出现/消失） |
| Kimi prompt | 不做断言式单测；调真 Kimi 跑端到端 smoke |
| 端到端 smoke | 脚本：触发 refresh → 等 ≤ 60s → 查 DB 验证有新 items + topics |

### 8.2 可观测性

- n8n 自带的执行历史界面（看每次工作流跑的成败、耗时、节点输出）
- 偶尔 SQL 查 `COUNT(*)` 做 sanity check
- 不上 Prometheus / Grafana（YAGNI）

---

## 9. 部署（native，不用 Docker）

### 9.1 服务器既有环境

部署目标：`coco@100.104.136.117`（Mac mini, Tailscale），已就绪：

| 组件 | 状态 |
|---|---|
| Homebrew Postgres 17 | ✅ 跑着，端口 5432，user `coco` 是 superuser，本地/127.0.0.1 trust 免密码 |
| n8n 2.17.5（nvm node v22） | ✅ 跑着，端口 5678；当前手动 `n8n start`，未托管 |
| Homebrew node v25 | ✅ 用于 RSSHub / Next.js |
| Tailscale | ✅ 服务器 IP 可达 |

### 9.2 新增组件

| 组件 | 安装方式 | 进程托管 |
|---|---|---|
| `news` database | 通过 `psql` 创建 | (静态) |
| RSSHub | `git clone` + `npm install`（或 `npm i -g rsshub`） | launchd plist |
| Next.js (`news-web`) | `npm install + npm run build`，`npm start` 跑 production server | launchd plist |
| n8n workflows | JSON 文件 in repo → `n8n import:workflow --input=...` 导入 | （由 n8n 自身托管） |
| n8n 自身的托管 | （MVP 不动；如需长期运行稳定，后续做 launchd 托管） | 推迟 v2 |

### 9.3 入口

`http://100.104.136.117:3000` — Tailscale 直连，无认证。

### 9.4 配置（本地 `.env` + 远程同步）

```
# 本地 web/.env.production
N8N_WEBHOOK_BASE=http://127.0.0.1:5678   # web 跟 n8n 在同一台机上

# n8n credential（在 n8n UI 里设一次，或通过 n8n CLI import:credentials）
KIMI_API_KEY=sk-...                       # 用户提供
news-postgres connection: localhost:5432, db=news, user=coco, password=(trust)

# 仓库内
infra/launchd/com.news.rsshub.plist
infra/launchd/com.news.web.plist
```

### 9.5 部署流程（`infra/scripts/deploy.sh` 一把梭）

```
本地 → SSH → 远程
1. rsync 仓库到远程 ~/code/news/
2. SSH 跑：
   a. infra/scripts/create-db.sh    （psql -U coco 建库）
   b. infra/scripts/migrate.sh      （psql 跑迁移）
   c. infra/scripts/install-rsshub.sh （首次：git clone + npm i）
   d. (cd web && npm install && npm run build)
   e. n8n import:workflow --separate --input=infra/n8n/workflows/
   f. launchctl load -w infra/launchd/com.news.rsshub.plist
   g. launchctl load -w infra/launchd/com.news.web.plist
3. 浏览器打开 http://100.104.136.117:3000 验证
```

所有命令都 idempotent（重复跑无副作用）。开发周期：本地改代码 → `bash infra/scripts/deploy.sh` → 立即生效。

---

## 10. MVP 范围

### ✅ 在 MVP 内

- 3 数据源：HN top + 6 Reddit sub + 12 X 账号（via RSSHub）
- HN 的 AI 相关性过滤
- 实体抽取 + 聚类 + 主题命名/摘要
- 🔥（近几天热）和 ⏫（上升中）标识
- 主屏：侧栏主题 + 混合信息流
- 主题点击筛选（含 AI 摘要 + 清除按钮）
- 手动刷新按钮
- 30 天滚动数据保留 + 7 天归档老 topic
- 4 个 Webhook API + Next.js 前端

### ⛔ 不在 MVP（推迟到 v2+）

- 外链文章正文抓取（含 PDF 论文）
- 实体同义词表 / 实体合并
- 大主题自动拆分
- 用户系统 / 多人 / 个性化
- 邮件 / IM 推送通知
- 移动端优化布局
- 全文搜索
- 条目级交互（收藏 / 隐藏 / 已读）
- 导出 / RSS 输出
- 评论摘要（Reddit/HN top comments）
- Prometheus / Grafana 监控

---

## 11. 待确认 / 后续

- **Kimi API key**：实现阶段需要用户提供
- **Postgres 凭据**：需要从既有 n8n 部署里获取
- **Reddit User-Agent**：填写一个个人化字符串避免被限流

---

## 附录 A：核心决策摘要

| 决策点 | 选择 |
|---|---|
| 内容类型 | AI 领域话题（A） |
| 使用场景 | 持续追踪 + 趋势观察（B + D） |
| 主屏布局 | 混合信息流 + 主题侧栏（C） |
| 主题聚合方式 | 实体抽取 + AI 命名（混合 C） |
| 整体架构 | n8n 一把梭（架构 A） |
| 实现方式 | 全部用 n8n Code 节点，不引入独立 Python CLI（B） |
| 数据库 | 新建独立 database `news` |
| LLM | Kimi (Moonshot) |
| 前端 | Next.js 14 + Tailwind + SWR |
| 访问控制 | 无（Tailscale 局域网信任） |
| 数据保留 | items 30 天滚动；topics 7 天无活跃归档，30 天后删除 |
