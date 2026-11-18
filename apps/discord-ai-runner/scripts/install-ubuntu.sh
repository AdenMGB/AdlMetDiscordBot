#!/usr/bin/env bash
# Deprecated — use PM2 from repo root: scripts/install-pm2-ubuntu.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
echo "Use $ROOT/scripts/install-pm2-ubuntu.sh (PM2, not systemd)." >&2
exec bash "$ROOT/scripts/install-pm2-ubuntu.sh"