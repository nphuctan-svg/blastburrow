#!/bin/zsh -l
set -e
cd -- "${0:A:h}"

game_url=http://127.0.0.1:4317
if curl -fsS "$game_url/health" | grep -q burrow-brigade; then
  open "$game_url"
  exit 0
fi
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm run build
node dist/server/server.js &
game_pid=$!
trap 'kill "$game_pid" 2>/dev/null || true' EXIT
for attempt in {1..50}; do
  if curl -fsS "$game_url/health" | grep -q burrow-brigade; then
    open "$game_url"
    wait "$game_pid"
    exit $?
  fi
  kill -0 "$game_pid" 2>/dev/null || exit 1
  sleep .2
done
print 'The game server did not become ready.'
exit 1
