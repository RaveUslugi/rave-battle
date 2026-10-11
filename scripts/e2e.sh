#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
compose="docker compose -p rave-e2e --env-file .env.e2e -f compose.e2e.yml"

cleanup() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    $compose logs server --tail 100 || true
  fi
  $compose down -v || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

$compose up -d --build --wait
bunx playwright test -c e2e/playwright.config.ts
