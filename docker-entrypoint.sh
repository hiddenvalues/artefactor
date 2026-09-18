#!/bin/sh
set -e

# One image, two roles (S37, AH29).
#
# renderer: the isolated thumbnail renderer. It renders untrusted artefact HTML
#   in sandboxed Chromium and must therefore be as empty as possible — no /data,
#   no database, no secrets, no privileges. So: no chown, no migrations, no gosu,
#   and it refuses to run as root (the container is started with an unprivileged
#   user; see deploy/docker-compose.example.yml).
# app (the default): the BFF. It starts as root so it can fix ownership of the
#   mounted /data volume — including a volume first created back when the image
#   ran as root — then drops privileges via gosu. /data holds the SQLite DB, the
#   artefact payloads and their thumbnails (S35).
case "${ARTEFACTOR_ROLE:-app}" in
  renderer)
    if [ "$(id -u)" = "0" ]; then
      echo "refusing to run the renderer as root: give the container an unprivileged user" >&2
      exit 1
    fi
    exec node dist/renderer/index.js
    ;;
  app)
    mkdir -p /data
    chown -R node:node /data

    # Apply migrations on boot so a fresh /data volume self-initializes, then serve.
    gosu node node dist/server/migrate.js
    exec gosu node node dist/server/index.js
    ;;
  *)
    echo "unknown ARTEFACTOR_ROLE '${ARTEFACTOR_ROLE}' (expected 'app' or 'renderer')" >&2
    exit 1
    ;;
esac
