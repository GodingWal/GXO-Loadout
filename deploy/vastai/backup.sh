#!/bin/bash
# Nightly backup of the inspection database and uploaded photos.
# Installed to cron by setup_server.sh. Archives locally to $BACKUP_DIR and,
# if BACKUP_REMOTE is set (any rsync/scp destination, e.g.
# "user@host:/backups/gxo" or an rclone remote via BACKUP_RCLONE), ships it off
# the box. Vast.ai instances are ephemeral rented hardware — keep copies elsewhere.
set -e

APP_DIR="${APP_DIR:-/opt/gxo-loadout}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$BACKUP_DIR/gxo-loadout-$STAMP.tar.gz"

mkdir -p "$BACKUP_DIR"
tar -czf "$ARCHIVE" -C "$APP_DIR" loadout.db uploads 2>/dev/null || \
  tar -czf "$ARCHIVE" -C "$APP_DIR" loadout.db
echo "Backup written: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# Keep the 14 most recent local archives
ls -1t "$BACKUP_DIR"/gxo-loadout-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

if [ -n "$BACKUP_REMOTE" ]; then
  rsync -az "$ARCHIVE" "$BACKUP_REMOTE" && echo "Shipped to $BACKUP_REMOTE"
elif [ -n "$BACKUP_RCLONE" ]; then
  rclone copy "$ARCHIVE" "$BACKUP_RCLONE" && echo "Shipped to $BACKUP_RCLONE"
else
  echo "NOTE: BACKUP_REMOTE/BACKUP_RCLONE not set — backup exists only on this instance."
fi
