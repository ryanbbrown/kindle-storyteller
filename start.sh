#!/usr/bin/env bash
set -euo pipefail

TLS_PORT="${TLS_PROXY_PORT:-8080}"
TLS_HEALTH_PORT="${TLS_PROXY_HEALTH_PORT:-8081}"
TLS_AUTH_KEYS="${TLS_PROXY_AUTH_KEYS:-}"
TLS_PRIMARY_KEY="${TLS_PROXY_API_KEY:-}"

if [[ -z "$TLS_AUTH_KEYS" && -n "$TLS_PRIMARY_KEY" ]]; then
  TLS_AUTH_KEYS="$TLS_PRIMARY_KEY"
fi

if [[ -z "$TLS_AUTH_KEYS" ]]; then
  echo "TLS proxy auth keys are required. Set TLS_PROXY_API_KEY or TLS_PROXY_AUTH_KEYS." >&2
  exit 1
fi

IFS=',' read -r FIRST_TLS_KEY _ <<<"$TLS_AUTH_KEYS"
FIRST_TLS_KEY="$(echo "$FIRST_TLS_KEY" | xargs)"
if [[ -z "$TLS_PRIMARY_KEY" ]]; then
  TLS_PRIMARY_KEY="$FIRST_TLS_KEY"
fi

export TLS_SERVER_URL="${TLS_SERVER_URL:-http://127.0.0.1:${TLS_PORT}}"
export TLS_SERVER_API_KEY="${TLS_SERVER_API_KEY:-$TLS_PRIMARY_KEY}"

start_tls_proxy() {
  (
    cd /app/tls-client
    AUTH_KEYS="$TLS_AUTH_KEYS" PORT="$TLS_PORT" HEALTH_PORT="$TLS_HEALTH_PORT" bash /app/tls-client/entrypoint.sh
  )
}

start_fastify() {
  (
    cd /app/server
    exec node dist/index.js
  )
}

start_tls_proxy &
TLS_PID=$!

start_fastify &
SERVER_PID=$!

cleanup() {
  kill "$TLS_PID" "$SERVER_PID" 2>/dev/null || true
  wait "$TLS_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup INT TERM

set +e
wait -n "$TLS_PID" "$SERVER_PID"
EXIT_CODE=$?
set -e
cleanup
exit "$EXIT_CODE"
