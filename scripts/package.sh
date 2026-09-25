#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Export the verified image; persistent data is never included.
for required in docker-compose.yml release/install.sh release/INSTALL.txt; do
  test -f "$required" || { echo "Missing $required" >&2; exit 1; }
done
cp docker-compose.yml release/docker-compose.yml
docker save tg-signer-dashboard:local | gzip -1 > release/tg-signer-dashboard.tar.gz.tmp
mv release/tg-signer-dashboard.tar.gz.tmp release/tg-signer-dashboard.tar.gz
cd release
# Keep editable installation settings out of the install-time checksum list.
# The complete archive checksum still covers docker-compose.yml.
sha256sum tg-signer-dashboard.tar.gz docker-compose.yml install.sh INSTALL.txt > SHA256SUMS
chmod 644 tg-signer-dashboard.tar.gz docker-compose.yml INSTALL.txt SHA256SUMS
chmod 755 install.sh
tar -czf tg-signer-dashboard-vps-amd64.tar.gz.tmp \
  --owner=0 --group=0 --transform='s,^,tg-signer-dashboard/,' \
  tg-signer-dashboard.tar.gz docker-compose.yml install.sh INSTALL.txt SHA256SUMS
mv tg-signer-dashboard-vps-amd64.tar.gz.tmp tg-signer-dashboard-vps-amd64.tar.gz
sha256sum tg-signer-dashboard-vps-amd64.tar.gz > tg-signer-dashboard-vps-amd64.tar.gz.sha256
chmod 644 tg-signer-dashboard-vps-amd64.tar.gz tg-signer-dashboard-vps-amd64.tar.gz.sha256
echo "部署包：$PWD/tg-signer-dashboard-vps-amd64.tar.gz"
