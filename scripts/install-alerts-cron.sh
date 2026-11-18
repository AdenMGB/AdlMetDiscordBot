#!/usr/bin/env bash
# Deprecated — alerts scheduling uses PM2 (see scripts/install-pm2-ubuntu.sh).
set -euo pipefail
echo "install-alerts-cron.sh is deprecated." >&2
echo "Use: chmod +x scripts/install-pm2-ubuntu.sh && ./scripts/install-pm2-ubuntu.sh" >&2
exit 1