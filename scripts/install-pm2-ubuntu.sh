#!/usr/bin/env bash
# PM2 for Ubuntu edge: Discord AI runner, rail fleet store, alerts push (cron → pm2).
set -euo pipefail

if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
	# shellcheck disable=SC1091
	source "${HOME}/.nvm/nvm.sh"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_EXAMPLE="$ROOT/.alerts-cron.env.example"

if ! command -v pnpm >/dev/null; then
	echo "pnpm not found — install Node/pnpm first." >&2
	exit 1
fi

if ! command -v pm2 >/dev/null; then
	echo "Installing pm2 …"
	npm install -g pm2
fi

chmod +x "$ROOT/scripts/push-alerts-cron.sh" \
	"$ROOT/scripts/pm2-discord-ai.sh" \
	"$ROOT/scripts/pm2-rail-fleet.sh"

if [[ ! -f "$ROOT/.alerts-cron.env" ]]; then
	if [[ -f "$ENV_EXAMPLE" ]]; then
		cp "$ENV_EXAMPLE" "$ROOT/.alerts-cron.env"
	else
		cat >"$ROOT/.alerts-cron.env" <<EOF
API_BASE=https://api.adlmetbot.adenmgb.com
ALERTS_CRON_SECRET=
EOF
	fi
	echo "Created $ROOT/.alerts-cron.env — set ALERTS_CRON_SECRET."
fi

mkdir -p "$ROOT/data" "$ROOT/apps/discord-ai-runner/data" "$ROOT/apps/rail-fleet-store/data"

echo "Installing workspace dependencies …"
(
	cd "$ROOT"
	pnpm install --filter @metro-mate/discord-ai-runner... --filter @metro-mate/rail-fleet-store...
)

# Remove legacy user cron for alerts
if crontab -l 2>/dev/null | grep -q push-alerts-cron.sh; then
	( crontab -l 2>/dev/null | grep -v push-alerts-cron.sh || true ) | crontab -
	echo "Removed user crontab entry for push-alerts-cron.sh"
fi

# Stop legacy systemd user units if present
for unit in metro-mate-discord-ai metro-mate-rail-fleet-store; do
	if systemctl --user list-unit-files --type=service 2>/dev/null | grep -q "^${unit}.service"; then
		systemctl --user disable --now "${unit}.service" 2>/dev/null || true
		echo "Disabled systemd user service ${unit}"
	fi
done

cd "$ROOT"
pm2 delete metro-mate-discord-ai metro-mate-rail-fleet-store metro-mate-alerts-push 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "PM2 status:"
pm2 status
echo ""
echo "Persist across reboot (run the command pm2 startup prints, if you have not already):"
pm2 startup systemd -u "$(whoami)" --hp "$HOME" || true
echo ""
echo "Logs:"
echo "  pm2 logs metro-mate-discord-ai"
echo "  pm2 logs metro-mate-rail-fleet-store"
echo "  pm2 logs metro-mate-alerts-push"
echo "Manual alerts test: $ROOT/scripts/push-alerts-cron.sh"