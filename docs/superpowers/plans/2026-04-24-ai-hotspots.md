# AI 信息热点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted single-user web app that aggregates AI hotspots from Hacker News, Reddit, and X (via RSSHub), uses Kimi LLM for topic clustering/summarization, and presents a feed + topic-sidebar UI.

**Architecture:** "n8n 一把梭" — n8n owns ingestion, AI processing, storage I/O, and the data API. Postgres stores items/topics. Next.js front-end calls n8n webhooks (proxied through its own API routes). All run **natively** on a single Mac mini (`coco@100.104.136.117`) accessed over Tailscale without auth. **No Docker** — Postgres is brew-managed, n8n is nvm-installed, RSSHub and Next.js will run as launchd-managed Node processes.

**Tech Stack:** n8n 2.17.5 (existing, workflow orchestration + Code nodes in JS), PostgreSQL 17 (brew, existing), RSSHub (npm), Kimi/Moonshot API, Next.js 14 (App Router) + Tailwind + SWR, Vitest + React Testing Library, launchd for process management.

**Reference spec:** `docs/superpowers/specs/2026-04-24-ai-hotspots-design.md`

**Server environment (already verified):**
- Host: `coco@100.104.136.117` (Mac mini, Tailscale). SSH key auth set up.
- PATH for non-interactive SSH does NOT include brew/nvm — every remote command must `source ~/.zshrc` or use absolute paths.
- Postgres: superuser `coco`, port 5432, local connections are `trust` (no password).
- n8n binary: `/Users/coco/.nvm/versions/node/v22.22.2/bin/n8n` (or `~/.nvm/versions/node/v22.22.2/bin/n8n`). Currently running on port 5678.
- Brew prefix: `/opt/homebrew`. `psql`, `node`, `npm`, `brew` all under `/opt/homebrew/bin`.

**Conventions used in this plan:**
- All file paths are relative to the local project root `/Users/wenren/code/news`.
- Code lives on the local Mac (this machine). Deployment = `rsync` to remote + SSH commands.
- Remote operations use `ssh coco@100.104.136.117 'source ~/.zshrc; <cmd>'` so PATH resolves.
- Code blocks marked `// in n8n Code node` are JavaScript pasted into a Code node (or embedded in a workflow JSON's `parameters.functionCode`).
- "n8n UI" or "n8n CLI" steps: workflows can be authored either by clicking in the UI at `http://100.104.136.117:5678` then exporting, OR by writing JSON directly to `infra/n8n/workflows/<name>.json` and importing via `n8n import:workflow --input=...`. The plan is structured for the CLI path so subagents can run end-to-end.
- Commit after each task using the message shown in the last step.

---

## Phase 0 — Project Bootstrap

### Task 1: Initialize project skeleton

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `infra/postgres/migrations/.gitkeep`
- Create: `infra/n8n/workflows/.gitkeep`
- Create: `infra/scripts/.gitkeep`
- Create: `web/.gitkeep`

- [ ] **Step 1: Initialize git and create folders**

```bash
cd /Users/wenren/code/news
git init
mkdir -p infra/postgres/migrations infra/n8n/workflows infra/scripts web
touch infra/postgres/migrations/.gitkeep infra/n8n/workflows/.gitkeep infra/scripts/.gitkeep web/.gitkeep
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
# env
.env
.env.local
*.env

# node
node_modules/
.next/
out/
dist/

# editors
.idea/
.vscode/
*.swp
.DS_Store

# logs
*.log

# brainstorm artifacts
.superpowers/

# n8n local data
.n8n/
```

- [ ] **Step 3: Write minimal `README.md`**

```markdown
# news — AI 信息热点

Self-hosted AI hotspot aggregator. See `docs/superpowers/specs/2026-04-24-ai-hotspots-design.md` for design.

## Quick start

1. Copy `.env.example` to `.env` and fill in values.
2. `docker compose up -d`
3. Import n8n workflows from `infra/n8n/workflows/` via the n8n UI.
4. Run migration: `bash infra/scripts/migrate.sh`
5. Open `http://localhost:3000` (or `http://100.104.136.117:3000` from Tailscale).

## Layout

- `infra/` — docker-compose, Postgres migrations, n8n workflow exports
- `web/` — Next.js front-end
- `docs/superpowers/` — design spec and plan
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore README.md infra web docs
git commit -m "chore: initial project skeleton"
```

---

### Task 2: Deployment env config + remote helper

**Files:**
- Create: `.env.example`
- Create: `infra/scripts/ssh.sh` (SSH helper that loads remote PATH)

- [ ] **Step 1: Write `.env.example`** (read by deploy scripts and Next.js build)

```bash
# Remote target
REMOTE_USER=coco
REMOTE_HOST=100.104.136.117
REMOTE_DIR=/Users/coco/code/news

# Postgres (on remote — local trust auth, no password needed)
PGUSER=coco
PGDATABASE=news
PGHOST=127.0.0.1
PGPORT=5432

# Service ports (on remote)
N8N_PORT=5678
RSSHUB_PORT=1200
WEB_PORT=3000

# Web env (rendered into web/.env.production by deploy script)
N8N_WEBHOOK_BASE=http://127.0.0.1:5678

# Kimi key — set in n8n credential, not exported to shell
# (importing credentials via n8n CLI is possible but encrypted; for MVP set once via UI)
```

- [ ] **Step 2: Write `infra/scripts/ssh.sh`** — wraps SSH with shell init so brew/nvm tools resolve

```bash
#!/usr/bin/env bash
# Run a command on the remote with login shell PATH (brew + nvm available).
# Usage: bash infra/scripts/ssh.sh '<command>'
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && source "$SCRIPT_DIR/.env"
REMOTE_USER="${REMOTE_USER:-coco}"
REMOTE_HOST="${REMOTE_HOST:-100.104.136.117}"
ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "source ~/.zshrc 2>/dev/null; export PATH=\$HOME/.nvm/versions/node/v22.22.2/bin:\$PATH; $1"
```

- [ ] **Step 3: Make executable + smoke test**

```bash
chmod +x infra/scripts/ssh.sh
cp .env.example .env
bash infra/scripts/ssh.sh 'which psql node n8n'
```

Expected: three absolute paths, e.g. `/opt/homebrew/bin/psql`, `/opt/homebrew/bin/node`, `/Users/coco/.nvm/versions/node/v22.22.2/bin/n8n`.

- [ ] **Step 4: Commit**

```bash
git add .env.example infra/scripts/ssh.sh
echo ".env" >> .gitignore && git add .gitignore
git commit -m "infra: deploy env + ssh helper for remote PATH"
```

---

## Phase 1 — Database Setup

### Task 3: Create `news` database (on remote)

**Files:**
- Create: `infra/scripts/create-db.sh`

- [ ] **Step 1: Write `infra/scripts/create-db.sh`** (idempotent, runs against remote via SSH helper)

```bash
#!/usr/bin/env bash
# Creates the `news` database on the remote Mac mini via SSH if missing.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DBNAME="${PGDATABASE:-news}"
DBUSER="${PGUSER:-coco}"

EXISTS=$(bash "$SCRIPT_DIR/ssh.sh" "psql -U $DBUSER -d postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='$DBNAME'\"" | tr -d '[:space:]')

if [ "$EXISTS" = "1" ]; then
  echo "Database '$DBNAME' already exists."
else
  bash "$SCRIPT_DIR/ssh.sh" "psql -U $DBUSER -d postgres -c \"CREATE DATABASE $DBNAME OWNER $DBUSER;\""
  echo "Created database '$DBNAME'."
fi
```

- [ ] **Step 2: Make executable and run**

```bash
chmod +x infra/scripts/create-db.sh
bash infra/scripts/create-db.sh
```

Expected output: `Created database 'news'.` (or `already exists.` on rerun).

- [ ] **Step 3: Verify connection**

```bash
bash infra/scripts/ssh.sh 'psql -U coco -d news -c "\dt"'
```

Expected: `Did not find any relations.` (empty database, no tables yet).

- [ ] **Step 4: Commit**

```bash
git add infra/scripts/create-db.sh
git commit -m "infra: create-db.sh — create remote news database via psql over SSH"
```

---

### Task 4: Schema migration SQL

**Files:**
- Create: `infra/postgres/migrations/001_init.sql`
- Create: `infra/scripts/migrate.sh`

- [ ] **Step 1: Write `infra/postgres/migrations/001_init.sql`**

```sql
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
```

- [ ] **Step 2: Write `infra/scripts/migrate.sh`** (rsync migrations, run psql remotely)

```bash
#!/usr/bin/env bash
# Apply all .sql files in infra/postgres/migrations/ in order against the remote news db.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] && source "$PROJECT_DIR/.env"
REMOTE_USER="${REMOTE_USER:-coco}"
REMOTE_HOST="${REMOTE_HOST:-100.104.136.117}"
REMOTE_DIR="${REMOTE_DIR:-/Users/coco/code/news}"
DBNAME="${PGDATABASE:-news}"
DBUSER="${PGUSER:-coco}"

ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "mkdir -p $REMOTE_DIR/infra/postgres/migrations"
rsync -az --delete "$PROJECT_DIR/infra/postgres/migrations/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/infra/postgres/migrations/"

for f in "$PROJECT_DIR/infra/postgres/migrations"/*.sql; do
  name=$(basename "$f")
  echo "Applying $name..."
  bash "$SCRIPT_DIR/ssh.sh" "psql -U $DBUSER -d $DBNAME -v ON_ERROR_STOP=1 -f $REMOTE_DIR/infra/postgres/migrations/$name"
done
echo "Done."
```

- [ ] **Step 3: Run migration**

```bash
chmod +x infra/scripts/migrate.sh
bash infra/scripts/migrate.sh
```

Expected: `Applying 001_init.sql...` then `Done.`

- [ ] **Step 4: Verify schema**

```bash
bash infra/scripts/ssh.sh 'psql -U coco -d news -c "\dt"'
bash infra/scripts/ssh.sh 'psql -U coco -d news -c "\d items"'
```

Expected: 3 tables (items, topics, item_topics) and items columns matching spec.

- [ ] **Step 5: Commit**

```bash
git add infra/postgres/migrations/001_init.sql infra/scripts/migrate.sh
git commit -m "db: initial schema for items, topics, item_topics"
```

---

## Phase 2 — RSSHub (native + launchd)

### Task 5: Install RSSHub + launchd plist + smoke test

**Files:**
- Create: `infra/scripts/install-rsshub.sh`
- Create: `infra/launchd/com.news.rsshub.plist`

- [ ] **Step 1: Write `infra/scripts/install-rsshub.sh`**

```bash
#!/usr/bin/env bash
# Install RSSHub on the remote (idempotent).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] && source "$PROJECT_DIR/.env"
REMOTE_USER="${REMOTE_USER:-coco}"
REMOTE_HOST="${REMOTE_HOST:-100.104.136.117}"

bash "$SCRIPT_DIR/ssh.sh" '
  set -e
  if [ ! -d ~/code/rsshub ]; then
    git clone --depth=1 https://github.com/DIYgod/RSSHub.git ~/code/rsshub
  fi
  cd ~/code/rsshub
  npm install --production
'
echo "RSSHub installed at ~/code/rsshub on remote."
```

- [ ] **Step 2: Write `infra/launchd/com.news.rsshub.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.news.rsshub</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/coco/code/rsshub/lib/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/coco/code/rsshub</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>CACHE_TYPE</key><string>memory</string>
    <key>PORT</key><string>1200</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/coco/Library/Logs/news-rsshub.log</string>
  <key>StandardErrorPath</key><string>/Users/coco/Library/Logs/news-rsshub.log</string>
</dict>
</plist>
```

- [ ] **Step 3: Install RSSHub remotely**

```bash
chmod +x infra/scripts/install-rsshub.sh
bash infra/scripts/install-rsshub.sh
```

Expected: clones (or skips), npm install runs (~2-5 minutes first time).

- [ ] **Step 4: Deploy launchd plist + load**

```bash
scp infra/launchd/com.news.rsshub.plist coco@100.104.136.117:~/Library/LaunchAgents/
bash infra/scripts/ssh.sh 'launchctl unload ~/Library/LaunchAgents/com.news.rsshub.plist 2>/dev/null; launchctl load -w ~/Library/LaunchAgents/com.news.rsshub.plist'
sleep 5
```

- [ ] **Step 5: Smoke test**

```bash
bash infra/scripts/ssh.sh 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:1200/'
bash infra/scripts/ssh.sh 'curl -s -o /tmp/karpathy.xml -w "%{http_code}\n" "http://127.0.0.1:1200/twitter/user/karpathy"; head -c 400 /tmp/karpathy.xml'
```

Expected: home page returns `200`. The Twitter route may return `200` with `<?xml` or fail if Twitter blocks RSSHub's scrape — if it fails, note it but don't block this task; revisit before Task 9. Also check the log:

```bash
bash infra/scripts/ssh.sh 'tail -20 ~/Library/Logs/news-rsshub.log'
```

- [ ] **Step 6: Commit**

```bash
git add infra/scripts/install-rsshub.sh infra/launchd/com.news.rsshub.plist
git commit -m "infra: native RSSHub install + launchd plist"
```

---

## Phase 3 — n8n Ingestion

> All n8n work below is done in the n8n UI at `http://100.104.136.117:5678` (or `http://localhost:5678` locally). After each workflow is built, **export it to JSON via Workflow menu → Download** and save to `infra/n8n/workflows/` so it lives in git.

### Task 6: n8n credentials

- [ ] **Step 1: Postgres credential**

In n8n UI: **Credentials → Add credential → Postgres**.
Name: `news-postgres`
- Host: `postgres`
- Database: `news`
- User: same as `POSTGRES_USER` in `.env`
- Password: same as `POSTGRES_PASSWORD`
- Port: `5432`
- SSL: disable

Test connection. Expected: green "Connection successful".

- [ ] **Step 2: Kimi (HTTP Header Auth) credential**

> Ask the user for the Kimi API key now. The key looks like `sk-...`. Do NOT proceed without it.

In n8n UI: **Credentials → Add credential → HTTP Header Auth**.
Name: `kimi-auth`
- Header name: `Authorization`
- Header value: `Bearer sk-<your-kimi-key>`

- [ ] **Step 3: Smoke test Kimi**

Create a throwaway workflow. Add an HTTP Request node:
- Method: POST
- URL: `https://api.moonshot.cn/v1/chat/completions`
- Authentication: `kimi-auth`
- Body type: JSON
- Body:
  ```json
  {
    "model": "moonshot-v1-8k",
    "messages": [{"role": "user", "content": "ping"}],
    "max_tokens": 10
  }
  ```

Execute the node. Expected: 200 response with a `choices[0].message.content` field. Delete the workflow after success.

- [ ] **Step 4: No commit needed.**

---

### Task 7: HN fetcher subworkflow

**Files:**
- Export to: `infra/n8n/workflows/hn-fetcher.json`

- [ ] **Step 1: Create new workflow named `hn-fetcher`**

Add nodes in order:

1. **Manual Trigger** (for testing) — leave default
2. **HTTP Request** node `Get Top Story IDs`:
   - URL: `https://hacker-news.firebaseio.com/v0/topstories.json`
   - Method: GET
3. **Code** node `Take 30`:
   ```javascript
   // in n8n Code node
   const ids = $input.first().json;
   return ids.slice(0, 30).map(id => ({ json: { id } }));
   ```
4. **HTTP Request** node `Get Item`:
   - URL: `=https://hacker-news.firebaseio.com/v0/item/{{$json.id}}.json`
   - Method: GET
   - Continue On Fail: ON
5. **Code** node `Normalize`:
   ```javascript
   // in n8n Code node — outputs unified item schema
   const out = [];
   for (const it of $input.all()) {
     const j = it.json;
     if (!j || !j.id || j.deleted || j.dead) continue;
     out.push({ json: {
       source: 'hn',
       source_id: String(j.id),
       title: j.title || '(untitled)',
       body: j.text || null,
       post_url: `https://news.ycombinator.com/item?id=${j.id}`,
       link_url: j.url || null,
       author: j.by || null,
       sub_or_handle: null,
       score: j.score || 0,
       comment_count: j.descendants || 0,
       published_at: new Date((j.time || 0) * 1000).toISOString()
     }});
   }
   return out;
   ```

- [ ] **Step 2: Manually trigger the workflow**

Click **Execute Workflow**. Expected: ~30 normalized items in the Normalize node output. Spot-check that `title`, `score`, `published_at` are populated.

- [ ] **Step 3: Export workflow JSON**

Workflow menu → Download → save as `infra/n8n/workflows/hn-fetcher.json`.

- [ ] **Step 4: Commit**

```bash
git add infra/n8n/workflows/hn-fetcher.json
git commit -m "n8n: hn-fetcher workflow"
```

---

### Task 8: Reddit fetcher subworkflow

**Files:**
- Export to: `infra/n8n/workflows/reddit-fetcher.json`

- [ ] **Step 1: Create workflow `reddit-fetcher`**

Nodes:

1. **Manual Trigger**
2. **Code** node `List Subs`:
   ```javascript
   // in n8n Code node
   const subs = ['LocalLLaMA','MachineLearning','singularity','OpenAI','ClaudeAI','StableDiffusion'];
   return subs.map(s => ({ json: { sub: s } }));
   ```
3. **HTTP Request** node `Fetch Sub`:
   - URL: `=https://www.reddit.com/r/{{$json.sub}}/hot.json?limit=25`
   - Method: GET
   - Headers: `User-Agent: news-aggregator/0.1 by your-reddit-username` (replace with the user's reddit username)
   - Continue On Fail: ON
4. **Code** node `Normalize`:
   ```javascript
   // in n8n Code node
   const out = [];
   for (const it of $input.all()) {
     const children = it.json?.data?.children || [];
     for (const c of children) {
       const d = c.data; if (!d) continue;
       out.push({ json: {
         source: 'reddit',
         source_id: d.id,
         title: d.title,
         body: d.selftext || null,
         post_url: `https://www.reddit.com${d.permalink}`,
         link_url: d.is_self ? null : d.url,
         author: d.author || null,
         sub_or_handle: 'r/' + d.subreddit,
         score: d.ups || 0,
         comment_count: d.num_comments || 0,
         published_at: new Date((d.created_utc || 0) * 1000).toISOString(),
         is_ai_relevant: true   // sub已限定AI主题
       }});
     }
   }
   return out;
   ```

- [ ] **Step 2: Execute workflow, expect ~150 normalized items (6 subs × 25)**

- [ ] **Step 3: Export to `infra/n8n/workflows/reddit-fetcher.json`**

- [ ] **Step 4: Commit**

```bash
git add infra/n8n/workflows/reddit-fetcher.json
git commit -m "n8n: reddit-fetcher workflow"
```

---

### Task 9: X (RSSHub) fetcher subworkflow

**Files:**
- Export to: `infra/n8n/workflows/x-fetcher.json`

- [ ] **Step 1: Create workflow `x-fetcher`**

Nodes:

1. **Manual Trigger**
2. **Code** node `List Handles`:
   ```javascript
   // in n8n Code node
   const handles = [
     'sama','AnthropicAI','demishassabis','ylecun',
     'karpathy','AndrewYNg','_jasonwei','giffmana',
     'swyx','simonw','jxnlco','abacaj'
   ];
   return handles.map(h => ({ json: { handle: h } }));
   ```
3. **HTTP Request** node `Fetch Feed`:
   - URL: `=http://rsshub:1200/twitter/user/{{$json.handle}}`
   - Method: GET
   - Continue On Fail: ON
   - Response Format: String
4. **Code** node `Parse RSS + Normalize`:
   ```javascript
   // in n8n Code node — minimal RSS parser, just enough for our fields
   const out = [];
   const cutoff = Date.now() - 72*3600*1000; // last 72h

   for (const it of $input.all()) {
     const xml = it.json?.data || it.json;
     if (typeof xml !== 'string') continue;

     // Pull handle from URL we requested
     const handle = (it.json?.url || '').split('/').pop();

     const items = xml.split('<item>').slice(1).map(s => '<item>' + s.split('</item>')[0]);
     for (const block of items) {
       const m = (re) => (block.match(re) || [,''])[1];
       const title = m(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
       const link  = m(/<link>([\s\S]*?)<\/link>/);
       const desc  = m(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
       const pub   = m(/<pubDate>([\s\S]*?)<\/pubDate>/);
       const guid  = m(/<guid[^>]*>([\s\S]*?)<\/guid>/) || link;
       const ts = pub ? Date.parse(pub) : Date.now();
       if (ts < cutoff) continue;
       out.push({ json: {
         source: 'x',
         source_id: guid,
         title: title.replace(/<[^>]+>/g,'').slice(0, 200) || '(no title)',
         body: desc.replace(/<[^>]+>/g,''),
         post_url: link,
         link_url: null,
         author: '@' + handle,
         sub_or_handle: '@' + handle,
         score: 0,                // RSSHub doesn't expose like counts
         comment_count: null,
         published_at: new Date(ts).toISOString(),
         is_ai_relevant: true
       }});
     }
   }
   return out;
   ```

- [ ] **Step 2: Execute workflow, expect a flat list of recent tweets across the 12 handles**

- [ ] **Step 3: Export to `infra/n8n/workflows/x-fetcher.json`**

- [ ] **Step 4: Commit**

```bash
git add infra/n8n/workflows/x-fetcher.json
git commit -m "n8n: x-fetcher workflow via RSSHub"
```

---

### Task 10: Main `ingest` workflow

**Files:**
- Export to: `infra/n8n/workflows/ingest.json`

- [ ] **Step 1: Create workflow `ingest`**

Nodes:

1. **Schedule Trigger** — every 30 minutes
2. Three **Execute Workflow** nodes in parallel: `hn-fetcher`, `reddit-fetcher`, `x-fetcher`
3. **Merge** node — Mode: `Append`
4. **Postgres** node `Upsert Items`:
   - Credential: `news-postgres`
   - Operation: **Execute Query**
   - Query (use `$json` interpolation in n8n's expression syntax for each row, but easier: use raw SQL with parameters per row in a Code node loop — see step 1.b below).

   Because n8n's Postgres node maps one row per input item nicely with the **Insert** operation but doesn't support `RETURNING (xmax = 0)` directly, use a **Code** node to build a single batch SQL statement, then execute it.

1. **(replace step 4)** **Code** node `Build Upsert SQL`:
   ```javascript
   // in n8n Code node
   const rows = $input.all().map(x => x.json).filter(r => r && r.source && r.source_id);
   if (!rows.length) return [{ json: { sql: 'SELECT 0', empty: true } }];

   const esc = (v) => v === null || v === undefined ? 'NULL'
     : typeof v === 'number' ? String(v)
     : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE')
     : "'" + String(v).replace(/'/g,"''") + "'";

   const values = rows.map(r => `(
     ${esc(r.source)}, ${esc(r.source_id)}, ${esc(r.title)}, ${esc(r.body)},
     ${esc(r.post_url)}, ${esc(r.link_url)}, ${esc(r.author)}, ${esc(r.sub_or_handle)},
     ${esc(r.score|0)}, ${esc(r.comment_count)}, ${esc(r.published_at)}, NOW(),
     ${r.is_ai_relevant === undefined ? 'NULL' : esc(r.is_ai_relevant)}
   )`).join(',\n');

   const sql = `
     INSERT INTO items
       (source, source_id, title, body, post_url, link_url, author, sub_or_handle,
        score, comment_count, published_at, fetched_at, is_ai_relevant)
     VALUES ${values}
     ON CONFLICT (source, source_id) DO UPDATE SET
       score         = EXCLUDED.score,
       comment_count = EXCLUDED.comment_count,
       fetched_at    = NOW()
     RETURNING id, (xmax = 0) AS is_new;`;

   return [{ json: { sql } }];
   ```
2. **Postgres** node `Execute Upsert`:
   - Operation: Execute Query
   - Query: `={{ $json.sql }}`
3. **Code** node `Collect New IDs`:
   ```javascript
   // in n8n Code node
   const rows = $input.first().json || [];
   const newIds = rows.filter(r => r.is_new === true).map(r => r.id);
   return [{ json: { newIds } }];
   ```
4. **IF** node `Has New?`:
   - Condition: `{{ $json.newIds.length }} > 0`
5. **Execute Workflow** node `Trigger Enrich`:
   - Workflow: `enrich` (will be created in Task 16)
   - Pass: `{ "newIds": $json.newIds }`

- [ ] **Step 2: Run manually to seed initial data**

Disable the Schedule trigger temporarily; click Execute Workflow. Expect: rows inserted in `items`. Verify:

```bash
docker exec -u postgres news-postgres-1 psql -d news -c "SELECT source, COUNT(*) FROM items GROUP BY source;"
```

Expected: counts for `hn`, `reddit`, `x` — all > 0.

- [ ] **Step 3: Re-enable Schedule trigger and Activate workflow**

- [ ] **Step 4: Export and commit**

```bash
git add infra/n8n/workflows/ingest.json
git commit -m "n8n: ingest workflow with cron + parallel fetch + UPSERT"
```

---

## Phase 4 — n8n Enrichment (AI Pipeline)

### Task 11: Skeleton `enrich` workflow + safety query

**Files:**
- Export to: `infra/n8n/workflows/enrich.json` (will be appended to in subsequent tasks)

- [ ] **Step 1: Create workflow `enrich`**

Nodes:

1. **Webhook Trigger** (or Workflow Trigger if called via Execute Workflow):
   - Workflow Trigger configured to receive `newIds`
2. **Code** node `Compute Target IDs`:
   ```javascript
   // in n8n Code node — union of passed-in newIds and any unprocessed within last 6h
   const passed = ($json.newIds || []);
   return [{ json: { passed } }];
   ```
3. **Postgres** node `Load Items`:
   - Operation: Execute Query
   - Query:
     ```sql
     SELECT id, source, source_id, title, body, post_url, link_url,
            author, sub_or_handle, score, published_at, is_ai_relevant
     FROM items
     WHERE id = ANY(ARRAY[{{ ($json.passed || []).join(',') || '0' }}]::bigint[])
        OR (is_ai_relevant IS NULL AND fetched_at > NOW() - INTERVAL '6 hours');
     ```
   - Note: when `passed` is empty, `ARRAY[0]::bigint[]` matches nothing (no row has id=0); the OR branch still picks up unprocessed items.

- [ ] **Step 2: Save (do not yet wire downstream)**

- [ ] **Step 3: No export yet — we'll commit at end of Task 16.**

---

### Task 12: HN AI relevance filter

> **Goal:** call Kimi to classify HN-only items as AI-related or not. Reddit/X items already have `is_ai_relevant = TRUE` from their fetcher.

- [ ] **Step 1: Add nodes after `Load Items`**

1. **IF** node `Need Classify?`:
   - Condition: `{{ $json.is_ai_relevant === null }}` AND `{{ $json.source === 'hn' }}`
   - True branch → next nodes; False branch → bypass to merge later
2. **Code** node `Build Classify Prompt`:
   ```javascript
   // in n8n Code node — batches HN items 50 per call
   const items = $input.all().map(x => x.json);
   const batches = [];
   for (let i = 0; i < items.length; i += 50) {
     const batch = items.slice(i, i + 50);
     const list = batch.map((b, idx) => `[${idx+1}] ${b.title}${b.body ? ' — ' + b.body.slice(0,200) : ''}`).join('\n');
     batches.push({
       ids: batch.map(b => b.id),
       prompt: `判断以下每条 Hacker News 内容是否是 AI / 机器学习 / LLM 相关。\n` +
               `仅返回 JSON 数组，长度等于条目数，每个元素是 true 或 false：\n[true, false, ...]\n\n` + list
     });
   }
   return batches.map(b => ({ json: b }));
   ```
3. **HTTP Request** node `Kimi Classify`:
   - Method: POST
   - URL: `https://api.moonshot.cn/v1/chat/completions`
   - Authentication: `kimi-auth`
   - Body Type: JSON
   - Body:
     ```json
     {
       "model": "moonshot-v1-8k",
       "messages": [{"role":"user","content": "{{ $json.prompt }}"}],
       "temperature": 0,
       "max_tokens": 1000
     }
     ```
4. **Code** node `Apply Verdicts`:
   ```javascript
   // in n8n Code node
   const out = [];
   for (const it of $input.all()) {
     const ids = it.json.ids || [];
     const content = it.json.choices?.[0]?.message?.content || '[]';
     let verdicts = [];
     try { verdicts = JSON.parse(content.match(/\[[\s\S]*\]/)[0]); } catch(e) {}
     ids.forEach((id, idx) => {
       out.push({ json: { id, is_ai_relevant: verdicts[idx] === true } });
     });
   }
   return out;
   ```
5. **Postgres** node `Update Relevance`:
   - Operation: Execute Query
   - Query:
     ```sql
     UPDATE items SET is_ai_relevant = {{ $json.is_ai_relevant }}
     WHERE id = {{ $json.id }};
     ```

- [ ] **Step 2: Test by manually executing with sample input `{ "newIds": [<an-hn-id>] }`**

Expected: items.is_ai_relevant updates from NULL to TRUE/FALSE for that HN id. Verify:

```bash
docker exec -u postgres news-postgres-1 psql -d news -c "SELECT id, source, is_ai_relevant FROM items WHERE id IN (<id>);"
```

- [ ] **Step 3: No export yet.**

---

### Task 13: Entity extraction

- [ ] **Step 1: Add nodes after the relevance branch (use Merge node to rejoin)**

1. **Merge** node `Rejoin All` — Mode: Append (combines passed-through Reddit/X + classified HN)
2. **Postgres** node `Filter Relevant`:
   - Query:
     ```sql
     SELECT id, source, title, body
     FROM items
     WHERE id = ANY(ARRAY[{{ $input.all().map(x => x.json.id).join(',') || '0' }}]::bigint[])
       AND is_ai_relevant = TRUE
       AND entities IS NULL;
     ```
3. **Code** node `Build Entity Prompts`:
   ```javascript
   // in n8n Code node — batch 30 items per call
   const items = $input.all().map(x => x.json);
   const batches = [];
   for (let i = 0; i < items.length; i += 30) {
     const batch = items.slice(i, i + 30);
     const list = batch.map((b, idx) => `[${idx+1}] ${b.title}\n${(b.body||'').slice(0,200)}`).join('\n\n');
     batches.push({
       ids: batch.map(b => b.id),
       prompt:
`从以下 AI 相关内容中提取实体。返回 JSON 数组，每个元素严格如下结构：
{"models":[],"people":[],"companies":[],"products":[],"topics":[]}
数组长度必须等于条目数。不要解释。

${list}`
     });
   }
   return batches.map(b => ({ json: b }));
   ```
4. **HTTP Request** node `Kimi Extract`:
   - Same URL/auth as Kimi Classify
   - Body:
     ```json
     {"model":"moonshot-v1-32k",
      "messages":[{"role":"user","content":"{{ $json.prompt }}"}],
      "temperature": 0,
      "max_tokens": 4000}
     ```
5. **Code** node `Apply Entities`:
   ```javascript
   // in n8n Code node
   const out = [];
   for (const it of $input.all()) {
     const ids = it.json.ids || [];
     const content = it.json.choices?.[0]?.message?.content || '[]';
     let entities = [];
     try { entities = JSON.parse(content.match(/\[[\s\S]*\]/)[0]); } catch(e) {}
     ids.forEach((id, idx) => {
       const e = entities[idx] || {};
       out.push({ json: {
         id,
         entities: {
           models:    Array.isArray(e.models)    ? e.models    : [],
           people:    Array.isArray(e.people)    ? e.people    : [],
           companies: Array.isArray(e.companies) ? e.companies : [],
           products:  Array.isArray(e.products)  ? e.products  : [],
           topics:    Array.isArray(e.topics)    ? e.topics    : []
         }
       }});
     });
   }
   return out;
   ```
6. **Postgres** node `Save Entities`:
   ```sql
   UPDATE items SET entities = '{{ JSON.stringify($json.entities) }}'::jsonb
   WHERE id = {{ $json.id }};
   ```

- [ ] **Step 2: Test by re-running enrich**

Verify:

```bash
docker exec -u postgres news-postgres-1 psql -d news -c "SELECT id, entities FROM items WHERE entities IS NOT NULL LIMIT 3;"
```

Expected: rows with non-null `entities` JSONB.

---

### Task 14: Clustering Code node

> Pure-JS in-process clustering. No LLM call here.

- [ ] **Step 1: Add `Postgres` node `Load Active Topics`**

```sql
SELECT id, key_entities FROM topics WHERE archived_at IS NULL;
```

- [ ] **Step 2: Add `Postgres` node `Load New Items`**

> Reference the IDs we already loaded upstream via `$('Load Items')`.

```sql
SELECT id, source, score, published_at, entities
FROM items
WHERE id = ANY(ARRAY[{{ $('Load Items').all().map(x => x.json.id).join(',') || '0' }}]::bigint[])
  AND is_ai_relevant = TRUE
  AND entities IS NOT NULL;
```

- [ ] **Step 3: Add `Code` node `Cluster`**

```javascript
// in n8n Code node
// Inputs available via $('Load Active Topics').all() and $('Load New Items').all()
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9一-鿿]+/g,'');

const itemEntitySet = (e) => {
  const arr = [...(e.models||[]), ...(e.companies||[]), ...(e.products||[])];
  return new Set(arr.map(norm).filter(Boolean));
};

const topics = $('Load Active Topics').all().map(x => ({
  id: x.json.id,
  ents: new Set((x.json.key_entities || []).map(norm).filter(Boolean))
}));

const intersect = (a, b) => { let n = 0; for (const v of a) if (b.has(v)) n++; return n; };

const attaches = []; // {item_id, topic_id}
const orphans  = []; // items not attached

for (const it of $('Load New Items').all()) {
  const itEnts = itemEntitySet(it.json.entities || {});
  if (itEnts.size === 0) continue;

  let best = null, bestN = 0;
  for (const t of topics) {
    const n = intersect(itEnts, t.ents);
    if (n >= 2 && n > bestN) { best = t; bestN = n; }
  }
  if (best) {
    attaches.push({ item_id: it.json.id, topic_id: best.id });
  } else {
    orphans.push({ id: it.json.id, ents: itEnts, raw: it.json });
  }
}

// Greedy clustering of orphans
const newClusters = [];
const used = new Set();
const orphArr = orphans.sort((a,b) => b.ents.size - a.ents.size);
for (const seed of orphArr) {
  if (used.has(seed.id)) continue;
  const cluster = [seed];
  used.add(seed.id);
  for (const cand of orphArr) {
    if (used.has(cand.id)) continue;
    if (intersect(seed.ents, cand.ents) >= 2) {
      cluster.push(cand); used.add(cand.id);
    }
  }
  if (cluster.length >= 2) newClusters.push(cluster);
  // singletons stay unassigned (used flag prevents re-seeding)
}

return [
  { json: { attaches, newClusters: newClusters.map(c => ({
      seed_entities: [...c[0].ents],
      items: c.map(x => x.raw)   // pass raw items for naming step
  })) } }
];
```

- [ ] **Step 4: Add `Postgres` node `Save Attaches`**

```sql
INSERT INTO item_topics (item_id, topic_id) VALUES
{{ $json.attaches.map(a => `(${a.item_id}, ${a.topic_id})`).join(',') || '(0,0)' }}
ON CONFLICT DO NOTHING;
UPDATE topics t SET
  last_active_at = NOW(),
  item_count = (SELECT COUNT(*) FROM item_topics WHERE topic_id = t.id)
WHERE id IN ({{ $json.attaches.map(a => a.topic_id).join(',') || '0' }});
```

> Note: skip the SQL entirely if `attaches.length === 0` — wrap in an IF node beforehand.

---

### Task 15: Naming + summary for new clusters

- [ ] **Step 1: Iterate over `newClusters` from Cluster node**

Add a **Split In Batches** node that emits one cluster per item.

- [ ] **Step 2: Code node `Build Naming Prompt`**

```javascript
// in n8n Code node
const cluster = $json;
const list = cluster.items.map((it, i) =>
  `[${i+1}] [${it.source}] ${it.raw?.title || it.title}\n${(it.raw?.body||it.body||'').slice(0,200)}`
).join('\n\n');

return [{ json: {
  prompt:
`以下是关于同一 AI 话题的 ${cluster.items.length} 条内容（来自 HN/Reddit/X）。请：
1. 给一个简短中文主题名（≤10 字，名词性，准确具体如"GPT-5 发布"）
2. 写 2-3 句话中文摘要（核心事件 + 各方观点要点）
3. 列出 5 个核心实体（模型/产品/公司/人）

返回 JSON：{"name":"...","summary":"...","key_entities":["...","..."]}

内容：
${list}`,
  item_ids: cluster.items.map(x => x.id)
}}];
```

- [ ] **Step 3: HTTP Request node `Kimi Name`**

Same auth/URL pattern, `model: "moonshot-v1-8k"`, `temperature: 0.2`, `max_tokens: 500`.

- [ ] **Step 4: Code node `Parse Naming Result`**

```javascript
// in n8n Code node
const c = $json.choices?.[0]?.message?.content || '{}';
let parsed = {};
try { parsed = JSON.parse(c.match(/\{[\s\S]*\}/)[0]); } catch(e) {}
return [{ json: {
  name: (parsed.name || 'Untitled topic').slice(0, 40),
  summary: parsed.summary || '',
  key_entities: Array.isArray(parsed.key_entities) ? parsed.key_entities : [],
  item_ids: $json.item_ids || []
}}];
```

- [ ] **Step 5: Postgres node `Insert Topic + Link Items`**

```sql
WITH new_topic AS (
  INSERT INTO topics (name, summary, key_entities, item_count, source_count, total_score, first_seen_at, last_active_at)
  VALUES (
    '{{ $json.name.replace(/'/g,"''") }}',
    '{{ $json.summary.replace(/'/g,"''") }}',
    '{{ JSON.stringify($json.key_entities) }}'::jsonb,
    {{ $json.item_ids.length }},
    0, 0, NOW(), NOW()
  ) RETURNING id
)
INSERT INTO item_topics (item_id, topic_id)
SELECT u.id, t.id FROM new_topic t,
  unnest(ARRAY[{{ $json.item_ids.join(',') }}]::bigint[]) AS u(id)
ON CONFLICT DO NOTHING;
```

> **Note:** skip if `item_ids.length === 0`.

---

### Task 16: Flag refresh + finalize `enrich`

- [ ] **Step 1: After all naming completes, add a single Postgres node `Refresh Flags`**

```sql
WITH stats AS (
  SELECT
    t.id AS topic_id,
    COUNT(DISTINCT i.source)        AS src_cnt,
    COALESCE(SUM(i.score), 0)::bigint AS total
  FROM topics t
  LEFT JOIN item_topics it ON it.topic_id = t.id
  LEFT JOIN items i ON i.id = it.item_id AND i.published_at > NOW() - INTERVAL '3 days'
  WHERE t.archived_at IS NULL
  GROUP BY t.id
),
ranked AS (
  SELECT s.topic_id, s.src_cnt, s.total,
         PERCENT_RANK() OVER (ORDER BY s.total DESC) AS pct_rank
  FROM stats s WHERE s.src_cnt >= 2
)
UPDATE topics t SET
  source_count = stats.src_cnt,
  total_score  = stats.total,
  is_hot       = COALESCE(ranked.pct_rank, 1) < 0.30,
  is_rising    = (t.first_seen_at > NOW() - INTERVAL '12 hours' AND t.item_count >= 3)
FROM stats
LEFT JOIN ranked USING (topic_id)
WHERE t.id = stats.topic_id;
```

- [ ] **Step 2: Save & manually run `enrich`**

Pass test input `{ "newIds": [<id>] }` (use any item id from items table).

Verify:

```bash
docker exec -u postgres news-postgres-1 psql -d news -c "SELECT id, name, item_count, is_hot, is_rising FROM topics ORDER BY last_active_at DESC LIMIT 10;"
docker exec -u postgres news-postgres-1 psql -d news -c "SELECT COUNT(*) FROM item_topics;"
```

Expected: at least one topic exists with `item_count > 0`. After several `ingest` runs, expect more topics with `is_hot = true`.

- [ ] **Step 3: Activate `enrich` workflow and `ingest` workflow**

- [ ] **Step 4: Export `enrich` and commit**

```bash
git add infra/n8n/workflows/enrich.json
git commit -m "n8n: enrich workflow — relevance, entities, clustering, naming, flags"
```

---

## Phase 5 — n8n Webhook API

### Task 17: GET /webhook/topics

**Files:**
- Export to: `infra/n8n/workflows/api-topics.json`

- [ ] **Step 1: Create workflow `api-topics`**

Nodes:

1. **Webhook** trigger:
   - HTTP Method: GET
   - Path: `topics`
   - Response Mode: When Last Node Finishes
2. **Postgres** node `Query Topics`:
   ```sql
   SELECT id, name, summary, item_count, source_count, total_score,
          is_hot, is_rising, last_active_at
   FROM topics
   WHERE archived_at IS NULL
   ORDER BY total_score DESC
   LIMIT 50;
   ```
3. **Respond to Webhook** node:
   - Response Body: `={{ { topics: $items().map(x => x.json) } }}`
   - Status: 200

- [ ] **Step 2: Hit endpoint to verify**

```bash
curl -s http://localhost:5678/webhook/topics | head -c 500
```

Expected: JSON `{"topics": [...]}`.

- [ ] **Step 3: Export & commit**

```bash
git add infra/n8n/workflows/api-topics.json
git commit -m "n8n: GET /webhook/topics"
```

---

### Task 18: GET /webhook/items

**Files:**
- Export to: `infra/n8n/workflows/api-items.json`

- [ ] **Step 1: Create workflow `api-items`**

Webhook trigger: GET, path `items`.

Postgres node:

```sql
WITH params AS (
  SELECT
    NULLIF('{{ $json.query.topic || "" }}', '')::bigint AS topic,
    NULLIF('{{ $json.query.source || "" }}', '')        AS source,
    LEAST(GREATEST(({{ $json.query.limit  || 50 }})::int, 1), 200) AS lim,
    GREATEST(({{ $json.query.offset || 0 }})::int, 0)              AS off
)
SELECT i.id, i.source, i.source_id, i.title, i.body, i.post_url, i.link_url,
       i.author, i.sub_or_handle, i.score, i.comment_count, i.published_at
FROM items i
LEFT JOIN item_topics it ON it.item_id = i.id
CROSS JOIN params p
WHERE i.is_ai_relevant = TRUE
  AND (p.topic  IS NULL OR it.topic_id = p.topic)
  AND (p.source IS NULL OR i.source    = p.source)
ORDER BY i.published_at DESC
LIMIT (SELECT lim FROM params)
OFFSET (SELECT off FROM params);
```

Respond: `={{ { items: $items().map(x=>x.json) } }}`

- [ ] **Step 2: Verify**

```bash
curl -s "http://localhost:5678/webhook/items?limit=5" | head -c 500
curl -s "http://localhost:5678/webhook/items?topic=1&limit=5" | head -c 500
```

- [ ] **Step 3: Export & commit**

```bash
git add infra/n8n/workflows/api-items.json
git commit -m "n8n: GET /webhook/items with topic/source/limit/offset"
```

---

### Task 19: GET /webhook/topics/:id

**Files:**
- Export to: `infra/n8n/workflows/api-topic-detail.json`

- [ ] **Step 1: Create workflow `api-topic-detail`**

Webhook: GET, path `topics/:id` (n8n supports path params).

Postgres node:

```sql
SELECT id, name, summary, key_entities, item_count, source_count, total_score,
       is_hot, is_rising, first_seen_at, last_active_at
FROM topics WHERE id = {{ $json.params.id }}::bigint;
```

Then a second Postgres query for related items:

```sql
SELECT i.id, i.source, i.title, i.post_url, i.score, i.published_at
FROM items i JOIN item_topics it ON it.item_id = i.id
WHERE it.topic_id = {{ $json.params.id }}::bigint
ORDER BY i.published_at DESC LIMIT 100;
```

Respond combined `{topic, items}`.

- [ ] **Step 2: Verify**

```bash
curl -s http://localhost:5678/webhook/topics/1 | head -c 800
```

- [ ] **Step 3: Export & commit**

```bash
git add infra/n8n/workflows/api-topic-detail.json
git commit -m "n8n: GET /webhook/topics/:id with related items"
```

---

### Task 20: POST /webhook/refresh

**Files:**
- Export to: `infra/n8n/workflows/api-refresh.json`

- [ ] **Step 1: Create workflow `api-refresh`**

Nodes:

1. **Webhook** trigger: POST, path `refresh`, Response Mode: When Last Node Finishes
2. **Execute Workflow** node — Workflow: `ingest`, "Wait for completion": OFF (fire-and-forget)
3. **Respond to Webhook**:
   - Body: `={{ { triggered: true, ts: new Date().toISOString() } }}`
   - Status: 200

- [ ] **Step 2: Verify**

```bash
curl -sX POST http://localhost:5678/webhook/refresh
```

Expected: `{"triggered":true,"ts":"..."}` and `ingest` execution visible in n8n executions list.

- [ ] **Step 3: Export & commit**

```bash
git add infra/n8n/workflows/api-refresh.json
git commit -m "n8n: POST /webhook/refresh"
```

---

## Phase 6 — Cleanup workflow

### Task 21: Daily cleanup

**Files:**
- Export to: `infra/n8n/workflows/cleanup.json`

- [ ] **Step 1: Create workflow `cleanup`**

Nodes:

1. **Schedule Trigger**: every day at 04:00
2. **Postgres** node:
   ```sql
   DELETE FROM items WHERE published_at < NOW() - INTERVAL '30 days';
   UPDATE topics SET archived_at = NOW()
     WHERE last_active_at < NOW() - INTERVAL '7 days' AND archived_at IS NULL;
   DELETE FROM topics WHERE archived_at < NOW() - INTERVAL '30 days';
   ```

- [ ] **Step 2: Run manually once to verify it succeeds with current data**

- [ ] **Step 3: Activate the workflow**

- [ ] **Step 4: Export & commit**

```bash
git add infra/n8n/workflows/cleanup.json
git commit -m "n8n: daily cleanup workflow"
```

---

## Phase 7 — Frontend Scaffold

### Task 22: Init Next.js + Tailwind + Vitest

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/next.config.mjs`
- Create: `web/tailwind.config.ts`
- Create: `web/postcss.config.mjs`
- Create: `web/vitest.config.ts`
- Create: `web/app/globals.css`
- Create: `web/app/layout.tsx`
- Create: `web/app/page.tsx`
- Create: `web/Dockerfile`
- Create: `web/.dockerignore`

- [ ] **Step 1: Bootstrap with create-next-app**

```bash
cd /Users/wenren/code/news/web
npx --yes create-next-app@14 . --ts --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm
```

When prompted to overwrite, accept. Then:

```bash
npm install swr
npm install -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Write `web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts']
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } }
});
```

- [ ] **Step 3: Write `web/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Add test script to `package.json`**

```bash
cd web && npm pkg set scripts.test="vitest run" scripts['test:watch']="vitest"
```

- [ ] **Step 5: Verify dev server boots**

```bash
cd web && npm run dev &
sleep 5
curl -s http://localhost:3000 | head -c 200
kill %1 2>/dev/null || true
```

Expected: HTML containing the default Next.js welcome page.

- [ ] **Step 6: Write `web/Dockerfile`**

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "start"]
```

- [ ] **Step 7: Write `web/.dockerignore`**

```
node_modules
.next
.env*
*.log
```

- [ ] **Step 8: Commit**

```bash
cd /Users/wenren/code/news
git add web/
git commit -m "web: bootstrap Next.js 14 + Tailwind + SWR + Vitest"
```

---

### Task 23: Types + API client

**Files:**
- Create: `web/lib/types.ts`
- Create: `web/lib/api.ts`
- Create: `web/lib/env.ts`

- [ ] **Step 1: Write `web/lib/types.ts`**

```ts
export type Source = 'hn' | 'reddit' | 'x';

export interface Item {
  id: number;
  source: Source;
  source_id: string;
  title: string;
  body: string | null;
  post_url: string;
  link_url: string | null;
  author: string | null;
  sub_or_handle: string | null;
  score: number;
  comment_count: number | null;
  published_at: string; // ISO
}

export interface Topic {
  id: number;
  name: string;
  summary: string | null;
  item_count: number;
  source_count: number;
  total_score: number;
  is_hot: boolean;
  is_rising: boolean;
  last_active_at: string;
}

export interface TopicDetail extends Topic {
  key_entities: string[] | null;
  first_seen_at: string;
  items: Item[];
}
```

- [ ] **Step 2: Write `web/lib/env.ts`**

```ts
export const N8N_BASE = process.env.N8N_WEBHOOK_BASE || 'http://localhost:5678';
```

- [ ] **Step 3: Write `web/lib/api.ts`**

```ts
import { N8N_BASE } from './env';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${N8N_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`n8n ${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export const n8n = {
  topics:        () => call<{ topics: import('./types').Topic[] }>('/webhook/topics'),
  items:         (q: { topic?: number; source?: string; limit?: number; offset?: number } = {}) => {
    const u = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v != null && u.set(k, String(v)));
    return call<{ items: import('./types').Item[] }>(`/webhook/items?${u}`);
  },
  topicDetail:   (id: number) => call<{ topic: import('./types').Topic; items: import('./types').Item[] }>(`/webhook/topics/${id}`),
  refresh:       () => call<{ triggered: boolean; ts: string }>('/webhook/refresh', { method: 'POST' })
};
```

- [ ] **Step 4: Commit**

```bash
cd /Users/wenren/code/news
git add web/lib
git commit -m "web: types and n8n client"
```

---

### Task 24: API route proxies

**Files:**
- Create: `web/app/api/topics/route.ts`
- Create: `web/app/api/items/route.ts`
- Create: `web/app/api/topics/[id]/route.ts`
- Create: `web/app/api/refresh/route.ts`

- [ ] **Step 1: Write `web/app/api/topics/route.ts`**

```ts
import { n8n } from '@/lib/api';
export async function GET() {
  try { return Response.json(await n8n.topics()); }
  catch (e: any) { return Response.json({ error: e.message }, { status: 502 }); }
}
```

- [ ] **Step 2: Write `web/app/api/items/route.ts`**

```ts
import { n8n } from '@/lib/api';
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = {
    topic:  u.searchParams.get('topic')  ? Number(u.searchParams.get('topic'))  : undefined,
    source: u.searchParams.get('source') || undefined,
    limit:  u.searchParams.get('limit')  ? Number(u.searchParams.get('limit'))  : undefined,
    offset: u.searchParams.get('offset') ? Number(u.searchParams.get('offset')) : undefined
  };
  try { return Response.json(await n8n.items(q)); }
  catch (e: any) { return Response.json({ error: e.message }, { status: 502 }); }
}
```

- [ ] **Step 3: Write `web/app/api/topics/[id]/route.ts`**

```ts
import { n8n } from '@/lib/api';
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try { return Response.json(await n8n.topicDetail(Number(params.id))); }
  catch (e: any) { return Response.json({ error: e.message }, { status: 502 }); }
}
```

- [ ] **Step 4: Write `web/app/api/refresh/route.ts`**

```ts
import { n8n } from '@/lib/api';
export async function POST() {
  try { return Response.json(await n8n.refresh()); }
  catch (e: any) { return Response.json({ error: e.message }, { status: 502 }); }
}
```

- [ ] **Step 5: Smoke test (with n8n already running)**

```bash
cd web && npm run dev &
sleep 5
curl -s http://localhost:3000/api/topics | head -c 300
kill %1 2>/dev/null || true
```

Expected: same JSON as `/webhook/topics`.

- [ ] **Step 6: Commit**

```bash
cd /Users/wenren/code/news
git add web/app/api
git commit -m "web: API route proxies for topics/items/refresh"
```

---

## Phase 8 — Frontend Components (TDD)

### Task 25: ItemCard component

**Files:**
- Create: `web/components/ItemCard.tsx`
- Create: `web/components/__tests__/ItemCard.test.tsx`

- [ ] **Step 1: Write failing test `ItemCard.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { ItemCard } from '../ItemCard';
import { Item } from '@/lib/types';

const sample: Item = {
  id: 1, source: 'hn', source_id: '42', title: 'Show HN: cool thing',
  body: null, post_url: 'https://news.ycombinator.com/item?id=42',
  link_url: 'https://example.com', author: 'pg', sub_or_handle: null,
  score: 123, comment_count: 7, published_at: '2026-04-24T08:00:00Z'
};

test('renders title, source badge, score', () => {
  render(<ItemCard item={sample} />);
  expect(screen.getByText('Show HN: cool thing')).toBeInTheDocument();
  expect(screen.getByText(/HN/)).toBeInTheDocument();
  expect(screen.getByText(/123/)).toBeInTheDocument();
});

test('links go to post_url', () => {
  render(<ItemCard item={sample} />);
  const link = screen.getByRole('link', { name: /Show HN/ });
  expect(link).toHaveAttribute('href', sample.post_url);
});
```

- [ ] **Step 2: Run test — should fail**

```bash
cd web && npm test -- ItemCard
```

Expected: failure (component does not exist).

- [ ] **Step 3: Write `web/components/ItemCard.tsx`**

```tsx
import { Item } from '@/lib/types';

const SRC_LABEL: Record<Item['source'], string> = { hn: 'HN', reddit: 'Reddit', x: 'X' };
const SRC_COLOR: Record<Item['source'], string> = {
  hn:     'text-orange-400',
  reddit: 'text-green-400',
  x:      'text-pink-400'
};

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)     return 'just now';
  if (diff < 3600)   return `${Math.floor(diff/60)}m`;
  if (diff < 86400)  return `${Math.floor(diff/3600)}h`;
  return `${Math.floor(diff/86400)}d`;
}

export function ItemCard({ item }: { item: Item }) {
  return (
    <article className="bg-white/[0.03] hover:bg-white/[0.06] rounded-md p-3 mb-2 transition">
      <div className="flex items-center gap-2 text-xs">
        <span className={`font-bold ${SRC_COLOR[item.source]}`}>{SRC_LABEL[item.source]}</span>
        <span className="text-neutral-500">· {timeAgo(item.published_at)}</span>
        {item.sub_or_handle && <span className="text-neutral-500">· {item.sub_or_handle}</span>}
      </div>
      <h3 className="mt-1 text-[15px] leading-snug text-neutral-100">
        <a href={item.post_url} target="_blank" rel="noreferrer" className="hover:underline">{item.title}</a>
      </h3>
      <div className="mt-1 text-xs text-neutral-500">
        {item.score} · {item.comment_count ?? 0} comments
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd web && npm test -- ItemCard
```

- [ ] **Step 5: Commit**

```bash
cd /Users/wenren/code/news
git add web/components/ItemCard.tsx web/components/__tests__/ItemCard.test.tsx
git commit -m "web: ItemCard component with tests"
```

---

### Task 26: TopicItem component

**Files:**
- Create: `web/components/TopicItem.tsx`
- Create: `web/components/__tests__/TopicItem.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { TopicItem } from '../TopicItem';
import { Topic } from '@/lib/types';

const sample: Topic = {
  id: 7, name: 'GPT-5 发布', summary: '...', item_count: 14, source_count: 3,
  total_score: 5000, is_hot: true, is_rising: false, last_active_at: '2026-04-24T08:00:00Z'
};

test('renders name, count, fire icon when hot', () => {
  render(<TopicItem topic={sample} active={false} onSelect={() => {}} />);
  expect(screen.getByText('GPT-5 发布')).toBeInTheDocument();
  expect(screen.getByText('14')).toBeInTheDocument();
  expect(screen.getByText(/🔥/)).toBeInTheDocument();
});

test('calls onSelect when clicked', () => {
  const onSelect = vi.fn();
  render(<TopicItem topic={sample} active={false} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole('button'));
  expect(onSelect).toHaveBeenCalledWith(7);
});

test('omits fire icon when not hot', () => {
  render(<TopicItem topic={{ ...sample, is_hot: false }} active={false} onSelect={() => {}} />);
  expect(screen.queryByText(/🔥/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Write `web/components/TopicItem.tsx`**

```tsx
import { Topic } from '@/lib/types';

export function TopicItem({ topic, active, onSelect }: {
  topic: Topic; active: boolean; onSelect: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(topic.id)}
      className={
        'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm text-left transition ' +
        (active
          ? 'bg-blue-400/20 text-blue-100 font-semibold border-l-2 border-blue-400'
          : 'hover:bg-white/[0.05] text-neutral-200')
      }
    >
      <span className="flex items-center gap-1">
        {topic.is_hot && <span aria-label="hot">🔥</span>}
        <span>{topic.name}</span>
      </span>
      <span className={'text-[10px] px-1.5 py-px rounded-full ' +
        (active ? 'bg-blue-400/40 text-white' : 'bg-white/[0.07] text-neutral-400')}>
        {topic.item_count}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit**

```bash
cd /Users/wenren/code/news
git add web/components/TopicItem.tsx web/components/__tests__/TopicItem.test.tsx
git commit -m "web: TopicItem component with tests"
```

---

### Task 27: TopicSidebar component

**Files:**
- Create: `web/components/TopicSidebar.tsx`
- Create: `web/components/__tests__/TopicSidebar.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { TopicSidebar } from '../TopicSidebar';
import { Topic } from '@/lib/types';

const t1: Topic = { id: 1, name: 'GPT-5', summary: null, item_count: 10, source_count: 3,
  total_score: 100, is_hot: true,  is_rising: false, last_active_at: '' };
const t2: Topic = { id: 2, name: 'MCP',   summary: null, item_count: 4,  source_count: 2,
  total_score: 50,  is_hot: false, is_rising: true,  last_active_at: '' };

test('renders sections 本周主题 and 上升中', () => {
  render(<TopicSidebar topics={[t1, t2]} activeId={null} onSelect={() => {}} />);
  expect(screen.getByText('本周主题')).toBeInTheDocument();
  expect(screen.getByText('上升中')).toBeInTheDocument();
  expect(screen.getByText('GPT-5')).toBeInTheDocument();
  expect(screen.getByText('MCP')).toBeInTheDocument();
});

test('calls onSelect with id', () => {
  const onSelect = vi.fn();
  render(<TopicSidebar topics={[t1, t2]} activeId={null} onSelect={onSelect} />);
  fireEvent.click(screen.getByText('GPT-5'));
  expect(onSelect).toHaveBeenCalledWith(1);
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Write `web/components/TopicSidebar.tsx`**

```tsx
import { Topic } from '@/lib/types';
import { TopicItem } from './TopicItem';

export function TopicSidebar({ topics, activeId, onSelect }: {
  topics: Topic[]; activeId: number | null; onSelect: (id: number | null) => void;
}) {
  const main   = topics.filter(t => !t.is_rising);
  const rising = topics.filter(t =>  t.is_rising);

  return (
    <aside className="w-48 shrink-0 bg-white/[0.04] rounded-lg p-3 self-start">
      <Section title="本周主题" topics={main}   activeId={activeId} onSelect={onSelect} />
      {rising.length > 0 && (
        <Section title="上升中" topics={rising} activeId={activeId} onSelect={onSelect} />
      )}
    </aside>
  );
}

function Section({ title, topics, activeId, onSelect }: {
  title: string; topics: Topic[]; activeId: number | null; onSelect: (id: number | null) => void;
}) {
  return (
    <div className="mb-3">
      <div className="text-[10px] font-semibold text-blue-300 uppercase tracking-wide mb-1.5">{title}</div>
      <div className="flex flex-col gap-0.5">
        {topics.map(t => (
          <TopicItem key={t.id} topic={t} active={t.id === activeId}
            onSelect={(id) => onSelect(id === activeId ? null : id)} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit**

```bash
cd /Users/wenren/code/news
git add web/components/TopicSidebar.tsx web/components/__tests__/TopicSidebar.test.tsx
git commit -m "web: TopicSidebar with sections and selection toggle"
```

---

### Task 28: FilterBar + ItemFeed

**Files:**
- Create: `web/components/FilterBar.tsx`
- Create: `web/components/ItemFeed.tsx`
- Create: `web/components/__tests__/ItemFeed.test.tsx`

- [ ] **Step 1: Write failing test for ItemFeed**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ItemFeed } from '../ItemFeed';
import { Item, Topic } from '@/lib/types';

const i1: Item = { id: 1, source: 'hn', source_id: '1', title: 'A',
  body: null, post_url: '#', link_url: null, author: null, sub_or_handle: null,
  score: 1, comment_count: 0, published_at: '2026-04-24T00:00:00Z' };

test('renders item list', () => {
  render(<ItemFeed items={[i1]} activeTopic={null} onClearTopic={() => {}} />);
  expect(screen.getByText('A')).toBeInTheDocument();
});

test('shows FilterBar when activeTopic provided', () => {
  const t: Topic = { id: 7, name: 'GPT-5', summary: 'A summary', item_count: 1,
    source_count: 1, total_score: 1, is_hot: false, is_rising: false, last_active_at: '' };
  const onClear = vi.fn();
  render(<ItemFeed items={[i1]} activeTopic={t} onClearTopic={onClear} />);
  expect(screen.getByText(/GPT-5/)).toBeInTheDocument();
  expect(screen.getByText(/A summary/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /清除/ }));
  expect(onClear).toHaveBeenCalled();
});

test('shows empty state', () => {
  render(<ItemFeed items={[]} activeTopic={null} onClearTopic={() => {}} />);
  expect(screen.getByText(/还没有.*热点/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Write `web/components/FilterBar.tsx`**

```tsx
import { Topic } from '@/lib/types';

export function FilterBar({ topic, onClear }: { topic: Topic; onClear: () => void }) {
  return (
    <div className="bg-blue-400/10 border-l-2 border-blue-400 px-3 py-2 rounded mb-3 flex items-center gap-3">
      <div className="flex-1 text-sm">
        <span>🔍 <strong className="text-blue-200">{topic.name}</strong></span>
        {topic.summary && <span className="text-neutral-300 ml-2">· {topic.summary}</span>}
      </div>
      <button onClick={onClear} className="text-xs text-pink-300 hover:text-pink-200">× 清除</button>
    </div>
  );
}
```

- [ ] **Step 4: Write `web/components/ItemFeed.tsx`**

```tsx
import { Item, Topic } from '@/lib/types';
import { ItemCard } from './ItemCard';
import { FilterBar } from './FilterBar';

export function ItemFeed({ items, activeTopic, onClearTopic }: {
  items: Item[]; activeTopic: Topic | null; onClearTopic: () => void;
}) {
  return (
    <div className="flex-1 min-w-0">
      {activeTopic && <FilterBar topic={activeTopic} onClear={onClearTopic} />}
      {items.length === 0 ? (
        <div className="text-neutral-400 text-sm py-8 text-center">
          近期还没有 AI 热点（n8n 工作流可能还没跑完）
        </div>
      ) : items.map(it => <ItemCard key={it.id} item={it} />)}
    </div>
  );
}
```

- [ ] **Step 5: Run — pass**

- [ ] **Step 6: Commit**

```bash
cd /Users/wenren/code/news
git add web/components/FilterBar.tsx web/components/ItemFeed.tsx web/components/__tests__/ItemFeed.test.tsx
git commit -m "web: ItemFeed + FilterBar with tests"
```

---

### Task 29: RefreshButton

**Files:**
- Create: `web/components/RefreshButton.tsx`
- Create: `web/components/__tests__/RefreshButton.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RefreshButton } from '../RefreshButton';

test('calls onRefresh when clicked and shows loading', async () => {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  render(<RefreshButton onRefresh={onRefresh} />);
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText(/刷新中/)).toBeInTheDocument();
  await waitFor(() => expect(onRefresh).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Write `web/components/RefreshButton.tsx`**

```tsx
'use client';
import { useState } from 'react';

export function RefreshButton({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } }}
      className="px-3 py-1.5 text-sm rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-blue-100 disabled:opacity-50"
    >
      {busy ? '刷新中…' : '刷新'}
    </button>
  );
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit**

```bash
cd /Users/wenren/code/news
git add web/components/RefreshButton.tsx web/components/__tests__/RefreshButton.test.tsx
git commit -m "web: RefreshButton with loading state"
```

---

### Task 30: HomeClient (integration)

**Files:**
- Create: `web/components/HomeClient.tsx`

- [ ] **Step 1: Write `web/components/HomeClient.tsx`**

```tsx
'use client';

import useSWR, { mutate } from 'swr';
import { useSearchParams, useRouter } from 'next/navigation';
import { Item, Topic } from '@/lib/types';
import { TopicSidebar } from './TopicSidebar';
import { ItemFeed } from './ItemFeed';
import { RefreshButton } from './RefreshButton';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function HomeClient(props: { initialTopics: Topic[]; initialItems: Item[] }) {
  const search   = useSearchParams();
  const router   = useRouter();
  const topicId  = search.get('topic') ? Number(search.get('topic')) : null;

  const { data: topicsData } = useSWR<{ topics: Topic[] }>(
    '/api/topics', fetcher, { fallbackData: { topics: props.initialTopics }, refreshInterval: 5*60*1000 }
  );
  const { data: itemsData } = useSWR<{ items: Item[] }>(
    `/api/items${topicId ? `?topic=${topicId}` : ''}`,
    fetcher,
    { fallbackData: { items: props.initialItems }, refreshInterval: 5*60*1000 }
  );

  const topics = topicsData?.topics ?? [];
  const items  = itemsData?.items  ?? [];
  const activeTopic = topics.find(t => t.id === topicId) || null;

  const setTopic = (id: number | null) => {
    const u = new URLSearchParams(search.toString());
    if (id == null) u.delete('topic'); else u.set('topic', String(id));
    router.push(`/?${u.toString()}`);
  };

  const refresh = async () => {
    await fetch('/api/refresh', { method: 'POST' });
    setTimeout(() => { mutate('/api/topics'); mutate(`/api/items${topicId ? `?topic=${topicId}` : ''}`); }, 60*1000);
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-neutral-100">AI 信息热点</h1>
        <RefreshButton onRefresh={refresh} />
      </header>
      <div className="flex gap-4">
        <TopicSidebar topics={topics} activeId={topicId} onSelect={setTopic} />
        <ItemFeed items={items} activeTopic={activeTopic} onClearTopic={() => setTopic(null)} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/wenren/code/news
git add web/components/HomeClient.tsx
git commit -m "web: HomeClient integration with SWR + URL state"
```

---

### Task 31: Server page + global styles

**Files:**
- Modify: `web/app/page.tsx`
- Modify: `web/app/layout.tsx`
- Modify: `web/app/globals.css`

- [ ] **Step 1: Replace `web/app/page.tsx`**

```tsx
import { HomeClient } from '@/components/HomeClient';
import { N8N_BASE } from '@/lib/env';
import type { Item, Topic } from '@/lib/types';

async function load(): Promise<{ topics: Topic[]; items: Item[] }> {
  try {
    const [t, i] = await Promise.all([
      fetch(`${N8N_BASE}/webhook/topics`,        { cache: 'no-store' }).then(r => r.json()),
      fetch(`${N8N_BASE}/webhook/items?limit=50`, { cache: 'no-store' }).then(r => r.json())
    ]);
    return { topics: t.topics ?? [], items: i.items ?? [] };
  } catch { return { topics: [], items: [] }; }
}

export default async function Page() {
  const { topics, items } = await load();
  return <HomeClient initialTopics={topics} initialItems={items} />;
}
```

- [ ] **Step 2: Replace `web/app/layout.tsx`**

```tsx
import './globals.css';

export const metadata = { title: 'AI 信息热点' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="bg-neutral-950 text-neutral-100 min-h-screen antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Replace `web/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body { background: #0a0a0a; }
```

- [ ] **Step 4: Boot the dev server and load the page**

```bash
cd web && npm run dev &
sleep 5
curl -s http://localhost:3000 | grep -E 'AI 信息热点'
kill %1 2>/dev/null || true
```

Expected: page HTML containing the title.

- [ ] **Step 5: Commit**

```bash
cd /Users/wenren/code/news
git add web/app
git commit -m "web: SSR page + dark layout"
```

---

## Phase 9 — End-to-End Smoke

### Task 32: Full pipeline smoke test

- [ ] **Step 1: Start everything fresh**

```bash
cd /Users/wenren/code/news
docker compose up -d --build
sleep 20
```

- [ ] **Step 2: Trigger a manual ingest via the API**

```bash
curl -sX POST http://localhost:5678/webhook/refresh
```

Expected: `{"triggered":true,...}`. Wait ~90 seconds for ingest + enrich to finish.

- [ ] **Step 3: Verify data in DB**

```bash
docker exec -u postgres news-postgres-1 psql -d news -c "
SELECT
  (SELECT COUNT(*) FROM items)         AS items,
  (SELECT COUNT(*) FROM topics)        AS topics,
  (SELECT COUNT(*) FROM item_topics)   AS links,
  (SELECT COUNT(*) FROM topics WHERE is_hot)    AS hot,
  (SELECT COUNT(*) FROM topics WHERE is_rising) AS rising;
"
```

Expected: items > 100, topics > 0, links > 0. (Hot may be 0 on first run — needs 3-day window of data.)

- [ ] **Step 4: Verify webhooks**

```bash
curl -s http://localhost:5678/webhook/topics  | head -c 200
curl -s http://localhost:5678/webhook/items?limit=3 | head -c 400
```

- [ ] **Step 5: Verify front-end**

Open `http://localhost:3000` (or `http://100.104.136.117:3000` from Tailscale) in a browser.

Verify:
1. Sidebar shows topics with item counts; some have 🔥 (after a few hours of data).
2. Main feed shows items with HN/Reddit/X badges and score.
3. Click a topic → URL gets `?topic=<id>`, feed filters, FilterBar appears.
4. Click "× 清除" → returns to full feed, URL drops `?topic`.
5. Click "刷新" → button shows "刷新中…", returns to "刷新" within ~1s; new items appear within 60s after polling.

- [ ] **Step 6: If all checks pass, push the branch and tag the commit**

```bash
cd /Users/wenren/code/news
git tag mvp-v1
git log --oneline | head -20
```

Expected: ~30 commits in chronological order.

---

## Reference: file map

```
news/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
├── docs/
│   └── superpowers/
│       ├── specs/2026-04-24-ai-hotspots-design.md
│       └── plans/2026-04-24-ai-hotspots.md
├── infra/
│   ├── postgres/migrations/001_init.sql
│   ├── n8n/workflows/                    (8 .json files)
│   └── scripts/
│       ├── create-db.sh
│       └── migrate.sh
└── web/
    ├── Dockerfile
    ├── package.json / tsconfig.json / next.config.mjs / tailwind.config.ts / postcss.config.mjs / vitest.config.ts
    ├── app/
    │   ├── layout.tsx / page.tsx / globals.css
    │   └── api/{topics,items,topics/[id],refresh}/route.ts
    ├── components/
    │   ├── HomeClient.tsx / TopBar (inline) / RefreshButton.tsx
    │   ├── TopicSidebar.tsx / TopicItem.tsx
    │   ├── ItemFeed.tsx / FilterBar.tsx / ItemCard.tsx
    │   └── __tests__/(5 .test.tsx files)
    └── lib/types.ts / api.ts / env.ts
```

## Reference: n8n workflow inventory

| File | Purpose | Trigger |
|---|---|---|
| `hn-fetcher.json` | HN top stories → normalized items | Manual / called by ingest |
| `reddit-fetcher.json` | Reddit /hot for 6 subs → normalized items | Manual / called by ingest |
| `x-fetcher.json` | RSSHub feeds for 12 X handles → normalized items | Manual / called by ingest |
| `ingest.json` | Cron 30min, parallel fetch, UPSERT, trigger enrich | Schedule |
| `enrich.json` | AI relevance + entity extract + cluster + name + flags | Workflow trigger from ingest |
| `api-topics.json` | GET /webhook/topics | Webhook |
| `api-items.json` | GET /webhook/items | Webhook |
| `api-topic-detail.json` | GET /webhook/topics/:id | Webhook |
| `api-refresh.json` | POST /webhook/refresh → triggers ingest | Webhook |
| `cleanup.json` | Daily delete old / archive inactive | Schedule |

10 workflow exports total.

## Known limitations (deferred to v2)

- No external article fetching (item bodies are platform-native only)
- No entity synonym table (case/punct normalization only)
- No topic auto-split when a cluster grows too broad
- X items have score=0 (RSSHub doesn't expose like counts) — they're ranked by recency within their source
- No mobile-optimized layout
- No full-text search
- No item-level interactions (save / hide / read)
