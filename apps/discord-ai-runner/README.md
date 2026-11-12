# Discord AI runner (Ubuntu)

Always-on **Node** app for Metro Mate mention chat. It connects to the Discord **Gateway**, builds richer reply/@mention context, calls **NVIDIA** with streaming, and **edits** the bot’s reply in place (no Cloudflare Worker relay).

## Requirements

- Ubuntu (or any Linux) with **Node 20+** and **pnpm**
- Developer Portal → Bot → **Message Content Intent** (privileged)
- `DISCORD_BOT_TOKEN` and `NVIDIA_API_KEY`

## Quick start

```bash
cd /path/to/adlmetbot
pnpm install

cp apps/discord-ai-runner/.env.example apps/discord-ai-runner/.env
# edit .env

pnpm --filter @metro-mate/discord-ai-runner dev
```

Production build + **systemd user service** (same pattern as alerts cron):

```bash
chmod +x apps/discord-ai-runner/scripts/install-ubuntu.sh
./apps/discord-ai-runner/scripts/install-ubuntu.sh
```

## Behaviour (vs old relay → Worker)

| | Old gateway relay | This runner |
|---|-------------------|-------------|
| Host | Forwards HTTP to Worker | Full AI on Ubuntu |
| Context | Last 5 channel messages | Configurable (default 20) + reply quotes |
| Triggers | @mention only | @mention **or** reply to Metro Mate |
| NVIDIA | Worker buffers then edits once | Stream with throttled Discord edits |

Slash commands (`/timetable`, `/fact`, etc.) still use the Cloudflare Worker interactions endpoint.

## Smoke test

```bash
pnpm --filter @metro-mate/discord-ai-runner smoke-nvidia
```
