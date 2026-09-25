#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data
chmod 700 data
if [ "$(id -u)" = 0 ]; then
  chown -R 10001:10001 data
elif [ ! -w data ]; then
  echo 'data directory must be writable by container UID 10001.' >&2
  exit 1
else
  docker run --rm -v "$PWD/data:/data" alpine:3.21 chown -R 10001:10001 /data
fi
docker compose up -d --build --wait --wait-timeout 120
echo 'Dashboard is ready at http://127.0.0.1:8999 (configure installation parameters in docker-compose.yml).'
echo 'First-use password: data/initial-password.txt (unless ADMIN_PASSWORD was provided).'
