#!/bin/sh
# The one running copy of Smile Sim on the owner's machine (.cursor/rules/machine-limits.mdc), on port 3000:
#   postgres and redis in their Docker containers (no image build), the API compiled from source with tsc --watch and
#   restarted on change (port 3001), the worker beside it, and the web in `next dev` (port 3000) proxying /api to it.
# Edits show up without a rebuild. Ctrl-C (or preview_stop) ends the whole copy; the database keeps its data.
set -eu
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://smilesim:smilesim@127.0.0.1:55432/smilesim}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:56379}"
export WEB_ORIGIN="${WEB_ORIGIN:-http://localhost:3000}"
export COOKIE_SECURE=false
export TRIAL_SEED="${TRIAL_SEED:-true}"
export TRIAL_SEED_ALLOW_PRODUCTION="${TRIAL_SEED_ALLOW_PRODUCTION:-true}"

# Only the data containers: the web and api containers would be a second copy.
docker compose stop web api worker >/dev/null 2>&1 || true
docker compose up -d --no-build postgres redis >/dev/null

cd apps/api
npx prisma migrate deploy >/dev/null
npx prisma generate >/dev/null
npx tsc -p tsconfig.build.json
npx tsc -p tsconfig.build.json --watch --preserveWatchOutput >/dev/null &
TSC=$!
PORT=3001 node --watch-path=dist dist/main.js &
API=$!
PORT=3001 node --watch-path=dist dist/worker.js &
WORKER=$!
cd ../..

trap 'kill $TSC $API $WORKER 2>/dev/null; docker compose stop postgres redis >/dev/null 2>&1' EXIT INT TERM
API_PROXY_URL=http://127.0.0.1:3001 NEXT_DIST_DIR=.next-view npm run dev --workspace web -- -p 3000
