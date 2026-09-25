#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null 2>&1 || {
  echo 'Docker is required. See INSTALL.txt.' >&2
  exit 1
}
if ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Compose v2 is required.' >&2
  exit 1
fi

sha256sum -c SHA256SUMS
docker load -i tg-signer-dashboard.tar.gz
mkdir -p data
chmod 700 data
if [ "$(id -u)" = 0 ]; then
  chown -R 10001:10001 data
else
  echo 'Run as root or make data writable by container UID 10001.' >&2
fi

docker compose up -d --no-build --pull never --wait dashboard
echo 'Dashboard is ready at http://127.0.0.1:8999'
if [ -f data/initial-password.txt ]; then
  echo 'First-use password: data/initial-password.txt'
fi
