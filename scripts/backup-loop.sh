#!/bin/sh
# Runs inside the "backup" container (docker-compose.prod.yml).
# Writes a compressed pg_dump to /backups once a day and deletes dumps older than BACKUP_KEEP_DAYS.
# Connection details come from PGHOST / PGUSER / PGPASSWORD / PGDATABASE.
set -eu

: "${BACKUP_INTERVAL_SECONDS:=86400}"
: "${BACKUP_KEEP_DAYS:=14}"

umask 077
mkdir -p /backups

while true; do
  file="/backups/sallagrazhda-$(date -u +%Y%m%d-%H%M%S).dump"
  if pg_dump --format=custom --no-owner --file="$file.partial"; then
    mv "$file.partial" "$file"
    echo "backup ok: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.partial"
    echo "backup FAILED at $(date -u)" >&2
  fi
  find /backups -name 'sallagrazhda-*.dump' -mtime +"$BACKUP_KEEP_DAYS" -delete
  sleep "$BACKUP_INTERVAL_SECONDS"
done
