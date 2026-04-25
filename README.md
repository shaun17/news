# news — AI 信息热点

Self-hosted AI hotspot aggregator. See `docs/superpowers/specs/2026-04-24-ai-hotspots-design.md` for design.

## Quick start

1. Copy `.env.example` to `.env` and fill in **all** values, including
   `TWITTER_AUTH_TOKEN` (auth_token cookie from x.com) and `MOONSHOT_API_KEY`.
2. Run `bash infra/scripts/create-db.sh` to create the `news` database on the remote.
3. Run `bash infra/scripts/migrate.sh` to apply schema migrations.
4. Run `bash infra/scripts/install-rsshub.sh` to install RSSHub on the remote.
5. Import n8n workflows from `infra/n8n/workflows/` via the n8n UI.
6. Deploy the web frontend + launchd jobs: `bash infra/scripts/deploy.sh`
7. Open `http://$REMOTE_HOST:$WEB_PORT` from Tailscale.

## Layout

- `infra/` — launchd plists, Postgres migrations, n8n workflow exports, deploy scripts
- `web/` — Next.js front-end
- `docs/superpowers/` — design spec and plan
