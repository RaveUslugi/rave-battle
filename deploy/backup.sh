#!/bin/sh
# Nightly logical backup at 03:00 UTC; keeps KEEP_DAYS days of dumps.
# BACKUP_NOW=1 makes one dump and exits (non-zero if it failed).
# A failed dump in the nightly loop is logged and retried next night; the container keeps running.
set -eu
KEEP_DAYS="${KEEP_DAYS:-14}"

dump() {
  file="/backups/rave-$(date -u +%Y%m%d-%H%M%S).dump"
  if pg_dump -Fc -f "$file.tmp" && mv "$file.tmp" "$file"; then
    echo "backup ok: $file"
    find /backups -name 'rave-*.dump' -mtime +"$((KEEP_DAYS - 1))" -delete
  else
    rm -f "$file.tmp"
    echo "backup FAILED: $file" >&2
    return 1
  fi
}

if [ "${BACKUP_NOW:-0}" = "1" ]; then
  dump
  exit $?
fi

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) 03:00" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  dump || true
done
