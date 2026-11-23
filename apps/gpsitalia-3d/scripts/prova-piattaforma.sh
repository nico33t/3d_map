#!/usr/bin/env bash
# Read-only check that the platform accepts the requests the proxy sends
# (Bearer token, no Origin header). The token is read silently, never saved,
# never printed; only HTTP status and record counts are shown.
set -euo pipefail
API="${PLATFORM_API_URL:-https://api.gpsitalia.com}"
read -rsp "Token di accesso (non viene mostrato né salvato): " TOKEN; echo
[ -n "$TOKEN" ] || { echo "Token vuoto."; exit 1; }
probe() {
  local path="$1" body status
  body=$(mktemp); trap 'rm -f "$body"' RETURN
  status=$(curl -sS -o "$body" -w '%{http_code}' --max-time 20 -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json' "$API$path" || echo "rete")
  local count
  count=$(node -e 'try{const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const d=Array.isArray(b)?b:Array.isArray(b?.data)?b.data:Array.isArray(b?.vehicles)?b.vehicles:null;console.log(d?d.length+" elementi":"oggetto")}catch{console.log("non JSON")}' "$body")
  printf '%-45s HTTP %s  %s\n' "$path" "$status" "$count"
}
probe "/api/vehicles?limit=5"
probe "/api/last-locations?page=1&limit=5"
unset TOKEN
