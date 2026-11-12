# Metro Mate (`adlmetbot`)

Verification bot for the **Adelaide Public Transport** Discord server. Runs on Cloudflare Workers at **`https://api.adlmetbot.adenmgb.com`**.

## What it does

- Serves Discord **interactions** (button clicks) on `POST /`
- Posts a one-time **Verify** embed in `#rules` via `POST /setup/verify-embed`
- Grants the **Verified** role when members click **Verify**

## Already configured (in `wrangler.jsonc`)

| Key | Value |
|-----|--------|
| `DISCORD_APPLICATION_ID` | `1569963528171815023` |
| `DISCORD_PUBLIC_KEY` | (see `wrangler.jsonc`) |
| `VERIFY_CHANNEL_ID` | `1569953806291308615` (`#rules`) |
| Custom domain | `api.adlmetbot.adenmgb.com` |

## Values you need to provide

Set these as **Wrangler secrets** (and in `.dev.vars` for local dev):

| Secret | What it is |
|--------|------------|
| `DISCORD_BOT_TOKEN` | Metro Mate bot token (Developer Portal → Bot → Reset/Copy) |
| `GUILD_ID` | Adelaide Public Transport server ID (Developer Mode → Copy Server ID) |
| `VERIFIED_ROLE_ID` | Role ID to grant on verify (Server Settings → Roles → … → Copy Role ID) |
| `SETUP_SECRET` | Long random string; protects the one-time embed setup endpoint |

```powershell
pnpm wrangler secret put DISCORD_BOT_TOKEN
pnpm wrangler secret put GUILD_ID
pnpm wrangler secret put VERIFIED_ROLE_ID
pnpm wrangler secret put SETUP_SECRET
```

Copy `.dev.vars.example` → `.dev.vars` with the same keys for `pnpm dev`.

## Discord Portal checklist

1. **Interactions Endpoint URL:** `https://api.adlmetbot.adenmgb.com`
2. **Invite Metro Mate** (Manage Roles + Send Messages + View Channels):

   ```
   https://discord.com/api/oauth2/authorize?client_id=1569963528171815023&permissions=268438528&scope=bot
   ```

3. **Server Settings → Roles:** drag **Metro Mate** above the **Verified** role (bot must rank higher than the role it assigns).

## Deploy

```powershell
pnpm install
pnpm run deploy
```

(`pnpm deploy` alone is pnpm’s monorepo command—not this Worker. Use **`pnpm run deploy`** or **`pnpm cf:deploy`**.)

## Slash commands

Register once (guild-scoped, updates quickly):

```powershell
pnpm run register-commands
```

Or after deploy:

```powershell
curl.exe -X POST "https://api.adlmetbot.adenmgb.com/setup/register-commands" -H "Authorization: Bearer YOUR_SETUP_SECRET"
```

| Command | Who | What |
|---------|-----|------|
| `/health` | Everyone | Worker + Discord API check (ephemeral) |
| `/timetable` | Everyone | Upcoming rail departures both ways (embed); line + station autocomplete |
| `/live-trains` | Everyone | Live sets (e.g. 4005), delay status, between-station position from GTFS-RT |
| `/alerts` | Everyone | Active **train, bus & tram** GTFS-RT service alerts (optional `line` filters trains) |
| `/disruption` | Everyone | Required **type** (train / bus / tram); optional **line** (train only) |
| `/fact` | Everyone | Adelaide Metro trivia via NVIDIA DeepSeek (`NVIDIA_API_KEY`; optional `topic`) |

Set `NVIDIA_API_KEY` in `.dev.vars` locally and `pnpm wrangler secret put NVIDIA_API_KEY` in production (from [NVIDIA build](https://build.nvidia.com/)).

### @Metro Mate mention chat (NVIDIA)

Slash commands use the **Interactions** endpoint; ordinary channel messages (including **@mentions**) need a small **Gateway relay** that forwards mentions to the Worker.

1. Developer Portal → **Bot** → enable **Message Content Intent** (privileged).
2. Optional secret: `pnpm wrangler secret put GATEWAY_RELAY_SECRET` (or reuse `SETUP_SECRET`).
3. On a always-on host (same Ubuntu box as alerts cron is fine):

```bash
cp .gateway-relay.env.example .gateway-relay.env   # DISCORD_BOT_TOKEN, SETUP_SECRET, API_BASE
pnpm install
pnpm run gateway-relay
```

When someone @mentions Metro Mate, the Worker fetches the **last 5 messages** in channel, calls NVIDIA, posts a short “thinking…” reply, then **edits** it to the answer (no stuck interaction deferrals).

Local smoke test:

```bash
export NVIDIA_API_KEY='…'
python3 scripts/nvidia_chat.py "one fact about the Gawler line"
```

### Disruption posts (Ubuntu cron)

`ALERTS_CHANNEL_ID` and `DISRUPTIONS_ROLE_ID` are in `wrangler.jsonc` (override via secrets if needed).

1. Deploy, then set `ALERTS_CRON_SECRET` (or reuse `SETUP_SECRET`):

```powershell
pnpm wrangler secret put ALERTS_CRON_SECRET
pnpm wrangler d1 migrations apply adlmetbot-gtfs --remote
```

2. On your Ubuntu box:

```bash
chmod +x scripts/push-alerts-cron.sh scripts/install-alerts-cron.sh
# edit .alerts-cron.env with ALERTS_CRON_SECRET
./scripts/install-alerts-cron.sh
```

Every **5 minutes** the cron job calls `POST /alerts/push`, which posts **new** train, bus, and tram alerts to the disruptions channel and pings **Disruptions Alerts**.

Manual test: `./scripts/push-alerts-cron.sh`

### Timetable data (D1 + GTFS)

1. Create the D1 database (once): `pnpm wrangler d1 create adlmetbot-gtfs` and set `database_id` in `wrangler.jsonc`.
2. Apply migrations: `pnpm wrangler d1 migrations apply adlmetbot-gtfs --local` (add `--remote` for production).
3. Import Adelaide Metro static GTFS into D1:

```powershell
python3 scripts/import-rail-gtfs.py --apply-remote
```

With `"remote": true` on the D1 binding in `wrangler.jsonc`, **`pnpm dev` uses the remote database** — you usually only need `--apply-remote`, not `--apply-local`.

Optional local SQLite copy (e.g. fully offline tests): `--apply-local` runs migrations on local D1 first, then loads the SQL file.

Re-run the import every week or so (or before each GTFS drop) so cached departures stay current.

`live-trains` also needs migration `0002_rail_live` and a GTFS import that fills `rail_trips` / `rail_trip_stops` (same import script as timetable).

## Post the verify embed (once)

```powershell
curl.exe -X POST "https://api.adlmetbot.adenmgb.com/setup/verify-embed" -H "Authorization: Bearer YOUR_SETUP_SECRET"
```

## Develop & test

```powershell
pnpm dev
pnpm test
```

Health: `GET https://api.adlmetbot.adenmgb.com/health`
