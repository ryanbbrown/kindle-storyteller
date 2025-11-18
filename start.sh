#!/usr/bin/env bash
set -euo pipefail

TLS_PORT=8080
TLS_HEALTH_PORT=8081
TLS_SERVER_API_KEY="${TLS_SERVER_API_KEY:-}"

if [[ -z "$TLS_SERVER_API_KEY" ]]; then
  echo "TLS_SERVER_API_KEY is required for the TLS proxy." >&2
  exit 1
fi

export TLS_SERVER_URL="http://127.0.0.1:${TLS_PORT}"

start_tls_proxy() {
  (
    cd /app
    AUTH_KEYS="$TLS_SERVER_API_KEY" PORT="$TLS_PORT" HEALTH_PORT="$TLS_HEALTH_PORT" bash /app/tls-client-entrypoint.sh
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
