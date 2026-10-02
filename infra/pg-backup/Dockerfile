# pg_dump must be the same major version as the server or newer.
# Production Postgres is 18.x (checked 2026-10-02).
FROM postgres:18-alpine

RUN apk add --no-cache age rclone curl \
 && mkdir -p /root/.config/rclone && touch /root/.config/rclone/rclone.conf

# Build context is this directory (railway up infra/pg-backup --path-as-root,
# or docker build infra/pg-backup).
COPY backup.sh restore-drill.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore-drill.sh

# Run once and exit: Railway cron starts the container on schedule.
ENTRYPOINT ["/usr/local/bin/backup.sh"]
