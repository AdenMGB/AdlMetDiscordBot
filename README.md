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
| `/post-verify` | Manage Server | Posts the verify embed in `#rules` |

## Post the verify embed (once)

HTTP alternative to `/post-verify`:

```powershell
curl.exe -X POST "https://api.adlmetbot.adenmgb.com/setup/verify-embed" -H "Authorization: Bearer YOUR_SETUP_SECRET"
```

## Develop & test

```powershell
pnpm dev
pnpm test
```

Health: `GET https://api.adlmetbot.adenmgb.com/health`
