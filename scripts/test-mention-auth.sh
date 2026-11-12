#!/usr/bin/env bash
# Quick check: relay secret matches production Worker (expect HTTP 400, not 401).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${GATEWAY_RELAY_ENV:-$ROOT/.gateway-relay.env}"

if [[ -f "$ENV_FILE" ]]; then
	# shellcheck disable=SC1090
	source "$ENV_FILE"
fi

API_BASE="${API_BASE:-https://api.adlmetbot.adenmgb.com}"
SECRET="${GATEWAY_RELAY_SECRET:-${SETUP_SECRET:-}}"

if [[ -z "$SECRET" ]]; then
	echo "Set GATEWAY_RELAY_SECRET or SETUP_SECRET in $ENV_FILE" >&2
	exit 1
fi

code=$(curl -s -o /tmp/mention-auth-body.txt -w "%{http_code}" -X POST "${API_BASE%/}/discord/mention" \
	-H "Authorization: Bearer ${SECRET}" \
	-H "Content-Type: application/json" \
	-d '{"channel_id":"1","message_id":"2","bot_user_id":"3","author_id":"4","author_username":"test","content":"hi"}')

echo "HTTP $code"
cat /tmp/mention-auth-body.txt
echo

if [[ "$code" == "401" ]]; then
	echo "Unauthorized — secret in $ENV_FILE does not match Cloudflare (wrangler secret list)." >&2
	exit 1
fi

if [[ "$code" == "204" ]]; then
	echo "Auth OK (worker accepted the request)."
	exit 0
fi

echo "Auth likely OK (got $code, not 401). Check body above for other errors." >&2
exit 0
