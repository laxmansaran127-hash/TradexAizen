#!/usr/bin/env bash
# Runs every offline test with tsx. Usage: bash tests/run.sh
cd "$(dirname "$0")/.." && for f in tests/*.test.ts; do echo "━━ $f"; npx tsx --tsconfig tests/tsconfig.json "$f" || exit 1; done
