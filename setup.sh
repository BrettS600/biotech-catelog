#!/usr/bin/env bash
# Installs the always-on eBay collector on a fresh Ubuntu 24.04 machine. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/BrettS600/biotech-catelog/main/setup.sh | bash
# Safe to run again: it keeps the secrets file and the deploy key if they already exist.
set -euo pipefail

REPO_URL="https://github.com/BrettS600/biotech-catelog.git"
BASE=/opt/pokemon-collector
ENV_FILE=/etc/pokemon-collector.env
SVC=pokemon-collector

echo "== Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git python3 python3-venv python3-pip curl >/dev/null

echo "== Service user and folders"
id -u collector >/dev/null 2>&1 || useradd --system --create-home --home-dir "$BASE" --shell /usr/sbin/nologin collector
mkdir -p "$BASE/data" "$BASE/.ssh"
chown -R collector:collector "$BASE"
chmod 700 "$BASE/.ssh"

echo "== Code"
if [ ! -d "$BASE/repo/.git" ]; then
  sudo -u collector git clone -q "$REPO_URL" "$BASE/repo"
else
  sudo -u collector git -C "$BASE/repo" pull -q --ff-only
fi
[ -d "$BASE/venv" ] || sudo -u collector python3 -m venv "$BASE/venv"
sudo -u collector "$BASE/venv/bin/pip" install -q --upgrade pip
sudo -u collector "$BASE/venv/bin/pip" install -q -r "$BASE/repo/requirements.txt"

echo "== Secrets"
if [ ! -f "$ENV_FILE" ]; then
  echo "Paste the four values (typing is hidden for the secret ones). They stay on this machine only."
  read -rp  "eBay App ID (Client ID): " EBAY_CLIENT_ID < /dev/tty
  read -rsp "eBay Cert ID (Client Secret): " EBAY_CLIENT_SECRET < /dev/tty; echo
  read -rsp "Site password: " SITE_PASSWORD < /dev/tty; echo
  read -rp  "Your ZIP code [02101]: " BUYER_ZIP < /dev/tty
  BUYER_ZIP=${BUYER_ZIP:-02101}
  umask 077
  printf 'EBAY_CLIENT_ID=%s\nEBAY_CLIENT_SECRET=%s\nSITE_PASSWORD=%s\nBUYER_ZIP=%s\n' \
    "$EBAY_CLIENT_ID" "$EBAY_CLIENT_SECRET" "$SITE_PASSWORD" "$BUYER_ZIP" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  echo "Keeping the existing $ENV_FILE"
fi

echo "== Deploy key (lets the machine push results to the repo's live branch)"
if [ ! -f "$BASE/.ssh/id_ed25519" ]; then
  sudo -u collector ssh-keygen -q -t ed25519 -N "" -C "pokemon-collector" -f "$BASE/.ssh/id_ed25519"
fi
sudo -u collector bash -c "ssh-keyscan -t ed25519 github.com 2>/dev/null > '$BASE/.ssh/known_hosts'"

echo "== Service"
cat > /etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=Pokemon card eBay collector
After=network-online.target
Wants=network-online.target

[Service]
User=collector
Group=collector
WorkingDirectory=$BASE/repo
EnvironmentFile=$ENV_FILE
Environment=COLLECTOR_HOME=$BASE
Environment=PYTHONUNBUFFERED=1
ExecStart=$BASE/venv/bin/python $BASE/repo/collector.py
Restart=always
RestartSec=15
# the collector exits on purpose after pulling new code; systemd brings it back on the new version
SuccessExitStatus=0

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q $SVC
systemctl restart $SVC

echo
echo "=================================================================="
echo "Installed. Add this deploy key to the repo, WITH write access:"
echo "  https://github.com/BrettS600/biotech-catelog/settings/keys/new"
echo "  Title: pokemon-collector    Tick: Allow write access"
echo
cat "$BASE/.ssh/id_ed25519.pub"
echo
echo "Until the key is added the collector runs but cannot publish (it will say 'Publish failed')."
echo "Watch it:   journalctl -u $SVC -f      Status:   systemctl status $SVC"
echo "=================================================================="
