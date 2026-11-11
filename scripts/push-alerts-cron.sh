#!/usr/bin/env bash
# Calls Metro Mate POST /alerts/push (train, bus & tram GTFS-RT alerts → Discord).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ALERTS_CRON_ENV:-$ROOT/.alerts-cron.env}"

if [[ -f "$ENV_FILE" ]]; then
	# shellcheck disable=SC1090
	source "$ENV_FILE"
fi

API_BASE="${API_BASE:-https://api.adlmetbot.adenmgb.com}"
SECRET="${ALERTS_CRON_SECRET:-${SETUP_SECRET:-}}"

if [[ -z "$SECRET" ]]; then
	echo "Set ALERTS_CRON_SECRET or SETUP_SECRET in $ENV_FILE" >&2
	exit 1
fi

curl -fsS -X POST "${API_BASE%/}/alerts/push" \
	-H "Authorization: Bearer ${SECRET}" \
	-H "Content-Type: application/json"
