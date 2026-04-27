#!/usr/bin/env bash
# 只部署仍由 launchd 托管的服务，并清理已经迁回 n8n 的旧任务。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$PROJECT_DIR/.env" ] || { echo "missing .env (copy from .env.example and fill secrets)" >&2; exit 1; }
set -a; source "$PROJECT_DIR/.env"; set +a

: "${REMOTE_USER:?}"; : "${REMOTE_HOST:?}"

# 这些变量只覆盖 web + rsshub 的 plist；采集和增强任务由 n8n 工作流接管。
required=(REMOTE_USER_HOME REMOTE_DIR MBP_PROXY RSSHUB_PORT WEB_PORT N8N_WEBHOOK_BASE
          TWITTER_AUTH_TOKEN)
for v in "${required[@]}"; do
  if [ -z "${!v:-}" ]; then echo "  ! \$$v is empty in .env" >&2; exit 1; fi
done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# launchd 只保留前端和 RSSHub，避免下次部署重新拉起 Python 采集/增强脚本。
launchd_labels=(com.news.web com.news.rsshub)
for label in "${launchd_labels[@]}"; do
  src="$PROJECT_DIR/infra/launchd/$label.plist"
  [ -f "$src" ] || { echo "missing launchd template: $src" >&2; exit 1; }
  envsubst < "$src" > "$TMP/$label.plist"
done

# 推送渲染后的 plist，然后在远端卸掉旧任务并重启保留任务。
ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "mkdir -p ~/Library/LaunchAgents"
rsync -az "$TMP/" "$REMOTE_USER@$REMOTE_HOST:~/Library/LaunchAgents/" --include='com.news.*.plist' --exclude='*'

ssh -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" 'set -e
  # launchd bootout 后服务状态可能还没完全释放，bootstrap 做短重试来避开瞬时 I/O error。
  bootstrap_label() {
    local label="$1"
    local plist="$2"

    for attempt in 1 2 3 4 5; do
      if launchctl bootstrap gui/$UID "$plist"; then
        echo "  ok: $label"
        return 0
      fi
      sleep 1
    done

    echo "  ! failed: $label" >&2
    launchctl print gui/$UID/"$label" 2>&1 || true
    return 1
  }

  for label in com.news.ingest com.news.enrich; do
    launchctl bootout gui/$UID/"$label" 2>/dev/null || true
    rm -f ~/Library/LaunchAgents/"$label".plist
    echo "  removed: $label"
  done

  for label in com.news.web com.news.rsshub; do
    p=~/Library/LaunchAgents/"$label".plist
    launchctl bootout gui/$UID/"$label" 2>/dev/null || true
    bootstrap_label "$label" "$p"
  done
'
echo "deploy-launchd done."
