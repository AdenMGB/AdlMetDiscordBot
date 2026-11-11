#!/usr/bin/env bash
# Installs a user crontab entry to push train alerts every 5 minutes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUSH="$ROOT/scripts/push-alerts-cron.sh"
ENV_EXAMPLE="$ROOT/.alerts-cron.env.example"

chmod +x "$PUSH"

if [[ ! -f "$ROOT/.alerts-cron.env" ]]; then
	cat >"$ROOT/.alerts-cron.env" <<EOF
# Used by push-alerts-cron.sh (do not commit secrets)
API_BASE=https://api.adlmetbot.adenmgb.com
ALERTS_CRON_SECRET=
EOF
	echo "Created $ROOT/.alerts-cron.env — add ALERTS_CRON_SECRET (or SETUP_SECRET)."
fi

CRON_LINE="*/5 * * * * ALERTS_CRON_ENV=$ROOT/.alerts-cron.env $PUSH >> $ROOT/data/alerts-cron.log 2>&1"

( crontab -l 2>/dev/null | grep -v "push-alerts-cron.sh" || true
  echo "$CRON_LINE"
) | crontab -

echo "Installed crontab:"
crontab -l | grep push-alerts-cron.sh || true
echo "Logs: $ROOT/data/alerts-cron.log"
echo "Example env: $ENV_EXAMPLE"
