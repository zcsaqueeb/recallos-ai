#!/bin/bash
# Final production verification: boots dev server, sweeps UI for demo text /
# console errors / overflow, checks API surface, then shuts the server down.
set -u
cd "$(cd "$(dirname "$0")/.." && pwd)"

# Secret detection patterns are loaded from .env at runtime — never hardcoded,
# so this script ships safely inside the repository.
if [ -f .env ]; then
  TATUM_PREFIX=$(grep -E '^TATUM_API_KEY=' .env | head -1 | cut -d= -f2 | cut -c1-20)
  WALRUS_PREFIX=$(grep -E '^WALRUS_MEMORY_DELEGATE_KEY=' .env | head -1 | cut -d= -f2 | cut -c1-20)
else
  TATUM_PREFIX=""; WALRUS_PREFIX=""
fi

PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "== Starting dev server =="
bun run dev > /tmp/verify-dev.log 2>&1 &
DEV_PID=$!
for i in $(seq 1 40); do
  curl -s -o /dev/null --max-time 2 http://localhost:3000/ && break
  sleep 1
done
curl -s -o /dev/null -w "" http://localhost:3000/ || { bad "server never became ready"; exit 1; }
ok "server ready"

echo "== API surface =="
ST=$(curl -s -o /tmp/status.json -w "%{http_code}" http://localhost:3000/api/status)
[ "$ST" = "200" ] && ok "GET /api/status -> 200" || bad "GET /api/status -> $ST"
grep -q '"tatum"' /tmp/status.json && ok "status exposes tatum section" || bad "status missing tatum section"
grep -qE "$TATUM_PREFIX" /tmp/status.json 2>/dev/null && bad "RAW TATUM KEY LEAKED in /api/status" || ok "no raw tatum key in /api/status"
grep -qE "$WALRUS_PREFIX" /tmp/status.json 2>/dev/null && bad "RAW WALRUS KEY LEAKED in /api/status" || ok "no raw walrus key in /api/status"
DEMO_SEED=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/demo/seed 2>/dev/null)
[ "$DEMO_SEED" = "404" ] && ok "POST /api/demo/seed -> 404 (route gone)" || bad "/api/demo/seed -> $DEMO_SEED (expected 404)"

echo "== Browser sweep: landing (1440x900) =="
agent-browser set viewport 1440 900 > /dev/null 2>&1
agent-browser open http://localhost:3000 > /dev/null 2>&1
agent-browser wait --load networkidle > /dev/null 2>&1
sleep 1
COUNTS=$(agent-browser eval "JSON.stringify({demo:(document.body.innerText.match(/demo/gi)||[]).length, workspace:(document.body.innerText.match(/Workspace: Local/gi)||[]).length, simulatedBanner:(document.body.innerText.match(/nothing is simulated/gi)||[]).length, proof:(document.body.innerText.match(/Newest on-chain proof/gi)||[]).length, plb:(document.body.innerText.match(/PLbUlpB8/gi)||[]).length, fixture:(document.body.innerText.match(/fixture/gi)||[]).length, overflow:(document.documentElement.scrollWidth>document.documentElement.clientWidth)?1:0})" 2>/dev/null | tr -d '\\')
echo "  landing counts: $COUNTS"
echo "$COUNTS" | grep -q '"demo":0' && ok "landing: 0 demo text" || bad "landing demo text: $COUNTS"
echo "$COUNTS" | grep -q '"workspace":0' && ok "landing: 0 workspace banner" || bad "landing workspace banner present"
echo "$COUNTS" | grep -q '"proof":0' && ok "landing: 0 proof strip" || bad "landing proof strip present"
echo "$COUNTS" | grep -q '"overflow":0' && ok "landing: no horizontal overflow" || bad "landing horizontal overflow"

echo "== Browser sweep: dashboard view (390x844 mobile) =="
agent-browser set viewport 390 844 > /dev/null 2>&1
# Enter the workspace from the landing page, then open Dashboard via nav
agent-browser eval "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Enter the workspace'))?.click() ?? 'CTA-NOT-FOUND'" > /dev/null 2>&1
sleep 2
agent-browser eval "[...document.querySelectorAll('button,a')].filter(b=>b.textContent.trim()==='Dashboard')[0]?.click()" > /dev/null 2>&1
sleep 2
MOB=$(agent-browser eval "JSON.stringify({overflow:(document.documentElement.scrollWidth>document.documentElement.clientWidth)?1:0, workspace:(document.body.innerText.match(/Workspace: Local/gi)||[]).length, demo:(document.body.innerText.match(/demo/gi)||[]).length})" 2>/dev/null | tr -d '\\')
echo "  mobile dashboard counts: $MOB"
echo "$MOB" | grep -q '"overflow":0' && ok "mobile dashboard: no horizontal overflow" || bad "mobile dashboard overflow: $MOB"
echo "$MOB" | grep -q '"workspace":0' && ok "mobile dashboard: 0 workspace banner" || bad "mobile workspace banner"
echo "$MOB" | grep -q '"demo":0' && ok "mobile dashboard: 0 demo text" || bad "mobile demo text: $MOB"

echo "== Browser sweep: settings view (desktop) =="
agent-browser set viewport 1440 900 > /dev/null 2>&1
sleep 1
agent-browser eval "[...document.querySelectorAll('button,a')].filter(b=>b.textContent.trim()==='Settings')[0]?.click()" > /dev/null 2>&1
sleep 2
CHK=$(agent-browser eval "document.body.innerText.includes('Walrus Memory') && document.body.innerText.includes('Tatum') ? 'SETTINGS-OK' : 'NOT-SETTINGS'" 2>/dev/null | tr -d '"')
echo "  settings view check: $CHK"
SET=$(agent-browser eval "JSON.stringify({walrus:(document.body.innerText.match(/Walrus/gi)||[]).length, tatum:(document.body.innerText.match(/Tatum/gi)||[]).length, grpc:(document.body.innerText.match(/gateway.tatum.io/gi)||[]).length, rawTatum:(document.body.innerText.includes(\"$TATUM_PREFIX\"))?1:0, rawWalrus:(document.body.innerText.includes(\"$WALRUS_PREFIX\"))?1:0, overflow:(document.documentElement.scrollWidth>document.documentElement.clientWidth)?1:0})" 2>/dev/null | tr -d '\\')
echo "  settings counts: $SET"
echo "$SET" | grep -q '"rawTatum":0' && ok "settings: raw Tatum key NOT in DOM" || bad "RAW TATUM KEY VISIBLE IN SETTINGS DOM"
echo "$SET" | grep -q '"rawWalrus":0' && ok "settings: raw Walrus key NOT in DOM" || bad "RAW WALRUS KEY VISIBLE IN SETTINGS DOM"
echo "$SET" | grep -q '"walrus"' && echo "$SET" | grep -q '"tatum"' && ok "settings: both credential cards present" || bad "credential cards missing: $SET"

echo "== Console / page errors =="
CONS=$(agent-browser console 2>/dev/null | grep -ci "error" || true)
errs=$(agent-browser errors 2>/dev/null | grep -v "No errors" | grep -c "." || true)
[ "${CONS:-0}" = "0" ] && ok "0 console errors" || bad "$CONS console errors"
[ "${errs:-0}" = "0" ] && ok "0 page errors" || bad "$errs page errors"

agent-browser close > /dev/null 2>&1
kill $DEV_PID > /dev/null 2>&1
wait $DEV_PID 2>/dev/null

echo ""
echo "== RESULT: $PASS passed, $FAIL failed =="
[ $FAIL -eq 0 ] && echo "ALL CHECKS PASSED" || echo "FAILURES PRESENT"
