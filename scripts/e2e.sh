#!/bin/sh
set -eu
compose="docker compose -p rave-e2e --env-file .env.e2e -f compose.e2e.yml"
$compose up -d --build --wait
status=0
bunx playwright test -c e2e/playwright.config.ts || status=$?
[ "$status" -ne 0 ] && $compose logs server --tail 100
$compose down -v
exit $status
