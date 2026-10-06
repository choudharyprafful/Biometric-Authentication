#!/usr/bin/env bash
# README "Quick start" step 3, then checks that the project really runs. Used by
# .github/workflows/quickstart.yml after steps 1 and 2.
#
#   bash scripts/ci/quickstart-run.sh DIR
#
# DIR is the folder step 2 was run in (it contains Biometric-Authentication). As in the README, the
# API starts in the step 2 window (inside the clone) and the web app in a second window (from DIR).
set -euo pipefail

dir="$(cd "$1" && pwd)"
repo="$dir/Biometric-Authentication"
block() { node "$repo/scripts/ci/quickstart-block.mjs" "$@"; }

block run-api > "$dir/run-api.sh"
block run-web > "$dir/run-web.sh"
echo "--- step 3, window 1 (in $repo):"; cat "$dir/run-api.sh"
echo "--- step 3, window 2 (in $dir):"; cat "$dir/run-web.sh"
(cd "$repo" && bash "$dir/run-api.sh" > "$dir/api.log" 2>&1) &
(cd "$dir" && bash "$dir/run-web.sh" > "$dir/web.log" 2>&1) &

show_logs() {
  echo "--- api.log"; tail -40 "$dir/api.log" || true
  echo "--- web.log"; tail -40 "$dir/web.log" || true
}
status() { curl -s -m 10 -o /dev/null -w "%{http_code}" "$1" || true; }
check() {
  if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (got $2, want $3)"; show_logs; exit 1; fi
}

for _ in $(seq 1 180); do
  [ "$(status http://localhost:8080/api/healthz)" = 200 ] && [ "$(status http://localhost:5173/)" = 200 ] && break
  sleep 1
done
echo "node $(node --version), pnpm $(pnpm --version)"
check "API http://localhost:8080/api/healthz" "$(status http://localhost:8080/api/healthz)" 200
check "web app http://localhost:5173/" "$(status http://localhost:5173/)" 200
# The API seeds the demo accounts only into an empty database; the sign-in below proves they exist.
if grep -q "Demo seed complete" "$dir/api.log"; then echo "PASS  demo accounts seeded into the new database"; else echo "NOTE  database already had data (not a first run)"; fi
# Vite compiles these on request: esbuild for the app code, Tailwind for the styles.
check "app code compiles (/src/main.tsx)" "$(status http://localhost:5173/src/main.tsx)" 200
check "styles compile (/src/index.css)" "$(status http://localhost:5173/src/index.css)" 200

# Sign in the way the browser does: through the web app's /api proxy, with the CSRF token.
jar="$dir/cookies.txt"
curl -s -m 10 -c "$jar" -b "$jar" -o /dev/null http://localhost:5173/api/auth/csrf
token=$(awk '$6 == "csrf_token" {print $7}' "$jar")
code=$(curl -s -m 20 -c "$jar" -b "$jar" -o "$dir/login.json" -w "%{http_code}" \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $token" -H "Origin: http://localhost:5173" \
  -d '{"email":"admin_user@prafful.com","password":"Password123!"}' http://localhost:5173/api/auth/login)
check "demo sign-in through the web app" "$code" 200
if grep -q '"email":"admin_user@prafful.com"' "$dir/login.json"; then
  echo "PASS  signed in as admin_user@prafful.com"
else
  echo "FAIL  sign-in response:"; cat "$dir/login.json"; show_logs; exit 1
fi

# The production build needs this platform's own esbuild, rollup, Tailwind and lightningcss binaries.
(cd "$repo" && pnpm --filter @workspace/secureai run build)
echo "PASS  production web build"
kill $(jobs -p) 2>/dev/null || true
