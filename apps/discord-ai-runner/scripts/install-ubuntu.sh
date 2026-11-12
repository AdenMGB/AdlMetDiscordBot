#!/usr/bin/env bash
# Installs a systemd --user service that keeps the Discord AI runner online (Ubuntu).
set -euo pipefail

if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
	# shellcheck disable=SC1091
	source "${HOME}/.nvm/nvm.sh"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
SERVICE_NAME="metro-mate-discord-ai"
UNIT_PATH="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/${SERVICE_NAME}.service"
ENV_FILE="$ROOT/.env"
ENV_EXAMPLE="$ROOT/.env.example"
LOG_DIR="$ROOT/data"
LOG_FILE="$LOG_DIR/runner.log"

mkdir -p "$(dirname "$UNIT_PATH")" "$LOG_DIR"

if [[ "$(loginctl show-user "$(whoami)" -p Linger --value 2>/dev/null || echo no)" != "yes" ]]; then
	if command -v sudo >/dev/null && sudo -n loginctl enable-linger "$(whoami)" 2>/dev/null; then
		echo "Enabled systemd linger for $(whoami) (service survives SSH logout)."
	else
		echo "WARNING: Linger is off — user systemd services stop when you log out."
		echo "  Run: sudo loginctl enable-linger $(whoami)"
	fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
	cp "$ENV_EXAMPLE" "$ENV_FILE"
	echo "Created $ENV_FILE — add DISCORD_BOT_TOKEN and NVIDIA_API_KEY."
fi

echo "Installing workspace dependencies from $REPO_ROOT …"
(
	cd "$REPO_ROOT"
	pnpm install --filter @metro-mate/discord-ai-runner...
)

PNPM_BIN="$(command -v pnpm)"
NODE_BIN_DIR="$(dirname "$(command -v node)")"

cat >"$UNIT_PATH" <<EOF
[Unit]
Description=Metro Mate Discord AI runner (NVIDIA streaming)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
Environment=NODE_ENV=production
Environment=PATH=$NODE_BIN_DIR:/usr/bin:/bin
EnvironmentFile=$ENV_FILE
ExecStart=$PNPM_BIN --dir $ROOT start
Restart=on-failure
RestartSec=5
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "${SERVICE_NAME}.service"

echo ""
echo "Installed ${UNIT_PATH}"
echo "Logs: $LOG_FILE"
echo "Status: systemctl --user status ${SERVICE_NAME}"
echo "Stop:   systemctl --user stop ${SERVICE_NAME}"
