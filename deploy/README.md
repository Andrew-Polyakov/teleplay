# Deploying Teleplay

Teleplay runs as a single always-on Node process. It receives Telegram updates via **webhook**
(the default) and also runs its own background workers (pre-match reminders, invitation-queue
expiry) in that same process. There is no separate database server or job queue — the SQLite
file is the only state that needs to persist.

## Prerequisites

- A domain name pointed at this host (an `A`/`AAAA` DNS record). Telegram requires webhooks to
  be served over HTTPS on a publicly reachable address — there's no way around having a domain.
- A bot token from [@BotFather](https://t.me/BotFather).
- A generated webhook secret: `openssl rand -hex 32`.

Fill in `.env` (copy from `.env.example`) with `TELEGRAM_BOT_TOKEN`, `PUBLIC_URL` (e.g.
`https://bot.example.com`, matching your domain, no trailing slash), and
`WEBHOOK_SECRET_TOKEN` (the value you generated above). The webhook itself is registered
automatically on startup via `setWebhook` — there's no manual `curl` step.

`BOT_MODE=polling` is available as a local-development fallback (see `.env.example`), since
testing webhooks locally normally requires a public HTTPS tunnel (e.g. ngrok). Don't use polling
mode for the actual deployment — it doesn't need a public URL, but it doesn't scale past
one dev machine and misses the reason to run webhooks at all.

## Option A: Docker Compose (recommended)

This runs Teleplay plus a [Caddy](https://caddyserver.com/) reverse proxy that automatically
gets and renews a TLS certificate for your domain.

1. Edit `deploy/Caddyfile`: replace `bot.example.com` with your real domain.
2. Make sure `.env` is filled in (see above) and `DATABASE_PATH` is left as the default — the
   compose file overrides it to point at the mounted `teleplay-data` volume automatically.
3. Run:
   ```sh
   docker compose up -d --build
   ```
4. Check logs: `docker compose logs -f teleplay`.

Migrations run automatically on container start. To update, `git pull`, then
`docker compose up -d --build` again — the container restarts with the new image and the
DB volume persists across restarts.

## Option B: Bare metal (systemd + Caddy)

1. On the host, install Node.js 22+, then:
   ```sh
   sudo useradd --system --create-home --home-dir /opt/teleplay teleplay
   sudo -u teleplay git clone <this repo> /opt/teleplay
   cd /opt/teleplay
   sudo -u teleplay npm ci --omit=dev
   sudo -u teleplay npm run build
   ```
2. Copy `.env` to `/opt/teleplay/.env` (owned by the `teleplay` user, not world-readable).
3. Install the systemd unit:
   ```sh
   sudo cp deploy/teleplay.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now teleplay
   ```
   This runs the migration on every start (`ExecStartPre`) and then starts the bot.
4. Install Caddy separately (`apt install caddy` or per [Caddy's docs](https://caddyserver.com/docs/install)),
   copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile` (uncomment the `reverse_proxy localhost:8080`
   line, comment out the Docker one), and `sudo systemctl reload caddy`.
5. Check status: `sudo systemctl status teleplay`, logs: `journalctl -u teleplay -f`.

To update: `git pull`, `npm ci --omit=dev`, `npm run build`, `sudo systemctl restart teleplay`.

## Verifying the webhook

After startup, confirm Telegram sees the webhook as registered and healthy:

```sh
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

`url` should match `PUBLIC_URL` + `WEBHOOK_PATH`, and `last_error_message` should be absent.
You can also hit `https://bot.example.com/healthz` directly — it should return `200 ok`.
