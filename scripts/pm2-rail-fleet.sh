#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
	# shellcheck disable=SC1091
	source "${HOME}/.nvm/nvm.sh"
fi
exec pnpm --dir "$ROOT/apps/rail-fleet-store" start