#!/bin/sh
# Entry point: if Cloudflare R2 backup is configured, run the app under litestream
# (continuous replication + restore-on-empty-volume for disaster recovery);
# otherwise start the app directly. No creds → identical behaviour to before.
set -e

: "${DB_PATH:=/app/server/data/wcoin.db}"
: "${BACKUP_R2_PATH:=wcoin-db}"

# ── One-shot reclaim of litestream's local shadow dir ─────────────────────────
# When R2 replication is denied (403), litestream can never confirm upload so it
# never truncates its local shadow WAL — it grew to 116GB and filled the volume.
# Those frames were NEVER replicated (pure junk, no recovery value). Set
# LITESTREAM_RESET_SHADOW=1 for ONE deploy to delete the stale shadow dir, then
# remove the flag. Only ever deletes the exact `.<db>-litestream` sidecar; the real
# DB (wcoin.db / -wal / -shm) is untouched.
if [ "$LITESTREAM_RESET_SHADOW" = "1" ]; then
  SHADOW="$(dirname "$DB_PATH")/.$(basename "$DB_PATH")-litestream"
  case "$SHADOW" in
    */.*-litestream)
      if [ -d "$SHADOW" ]; then
        echo "[entrypoint] LITESTREAM_RESET_SHADOW=1 — removing stale shadow dir $SHADOW"
        rm -rf "$SHADOW" && echo "[entrypoint] shadow dir removed"
      else
        echo "[entrypoint] LITESTREAM_RESET_SHADOW=1 — no shadow dir at $SHADOW (nothing to do)"
      fi
      ;;
    *)
      echo "[entrypoint] refusing to remove unexpected shadow path: $SHADOW"
      ;;
  esac
fi

# LITESTREAM_OFF=1 disables replication without dropping the R2 creds (so they can
# be fixed/rotated and re-enabled later). With it set — or with no creds — the app
# runs directly and manages its own WAL checkpointing (config.backupActive=false).
if [ "$LITESTREAM_OFF" != "1" ] && [ -n "$BACKUP_R2_BUCKET" ] && [ -n "$BACKUP_R2_ACCESS_KEY_ID" ] && [ -n "$BACKUP_R2_SECRET_ACCESS_KEY" ]; then
  echo "[entrypoint] R2 backup ENABLED (bucket=$BACKUP_R2_BUCKET path=$BACKUP_R2_PATH endpoint=$BACKUP_R2_ENDPOINT)"
  # Render the litestream config with REAL values via shell expansion — do NOT rely
  # on litestream's own ${VAR} interpolation (that was silently leaving the config
  # unresolved, so nothing was written to R2). Unquoted heredoc expands $VARs here.
  cat > /tmp/litestream.yml <<EOF
dbs:
  - path: ${DB_PATH}
    # NOTE: do NOT raise checkpoint-interval / min-checkpoint-page-count here. Letting
    # the WAL grow larger before checkpointing makes litestream's SHUTDOWN RESTART
    # checkpoint take longer — and on Railway's recreate deploys the old container's
    # shutdown checkpoint (holding the write lock) overlaps with the new container's
    # boot writes, so a big WAL → long checkpoint → new container's seedWatchlist hits
    # SQLITE_BUSY and crashes (fatal deploy loop, took the site down 2026-06-19).
    # Defaults (checkpoint-interval 1m, min-checkpoint-page-count 1000) keep the WAL
    # small so shutdown checkpoints are quick. The occasional runtime "database is
    # locked" log line is benign (self-healing, no data loss) — leave it.
    replicas:
      - type: s3
        bucket: ${BACKUP_R2_BUCKET}
        path: ${BACKUP_R2_PATH}
        endpoint: ${BACKUP_R2_ENDPOINT}
        access-key-id: ${BACKUP_R2_ACCESS_KEY_ID}
        secret-access-key: ${BACKUP_R2_SECRET_ACCESS_KEY}
        region: auto
        force-path-style: true
        retention: 72h
        snapshot-interval: 24h
EOF
  if [ ! -f "$DB_PATH" ]; then
    echo "[entrypoint] no local DB at $DB_PATH — attempting restore from R2…"
    litestream restore -if-replica-exists -config /tmp/litestream.yml "$DB_PATH" \
      && echo "[entrypoint] restore complete" \
      || echo "[entrypoint] no replica to restore — starting fresh"
  fi
  exec litestream replicate -config /tmp/litestream.yml -exec "npm start"
else
  if [ "$LITESTREAM_OFF" = "1" ]; then
    echo "[entrypoint] litestream DISABLED via LITESTREAM_OFF=1 — starting app directly (app self-manages WAL)"
  else
    echo "[entrypoint] R2 backup disabled (no creds) — starting app directly"
  fi
  exec npm start
fi
