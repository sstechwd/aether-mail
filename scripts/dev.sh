#!/usr/bin/env bash
# Start the morning MVP: API on :8787 and Vite on :5173
set -euo pipefail
cd "$(dirname "$0")/.."
echo "API  http://127.0.0.1:8787/api/health"
echo "UI   http://127.0.0.1:5173"
npx --yes concurrently -k -n api,web -c blue,green "npm run dev -w @aether/api" "npm run dev -w @aether/web"
