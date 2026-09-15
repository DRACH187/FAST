#!/bin/bash
# ONE-SHOT end-to-end verification for FAST GUNS.
# The sandbox reaps background processes at each tool-call boundary, so the
# server, browser session, and all probes must live inside THIS invocation.
set -u
cd /home/z/my-project
B="agent-browser"
TR=/home/z/my-project/tool-results
mkdir -p "$TR"

# ------------------------------------------------------------- start server
setsid sh -c 'bun run dev > dev.log 2>&1 < /dev/null' &
code=000
for i in $(seq 1 40); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true)
  [ "$code" = "200" ] && break
done
echo "== server ready: HTTP $code =="

waitfor() { # waitfor <css-selector> <max-seconds>
  for i in $(seq 1 "${2:-15}"); do
    n=$($B get count "$1" 2>/dev/null | tr -dc '0-9')
    [ "${n:-0}" -ge 1 ] && return 0
    sleep 1
  done
  return 1
}

# ------------------------------------------------------------- browser flow
$B set viewport 390 844 >/dev/null 2>&1
$B open http://localhost:3000 >/dev/null 2>&1
$B wait --load networkidle >/dev/null 2>&1

echo "== gate screen =="
waitfor "input[aria-label='Access code']" 20 || echo "FAIL: gate input never appeared"
$B screenshot "$TR/verify-gate.png" >/dev/null 2>&1
$B snapshot -i -c 2>/dev/null | head -12

echo "== gate: wrong code 999 =="
$B find label "Access code" fill "999" >/dev/null 2>&1
sleep 2.5
$B get count "input[aria-label='Access code']" 2>/dev/null | tr -dc '0-9' | sed 's/^/gate input still present: /'

echo "== gate: correct code 187 =="
$B find label "Access code" fill "187" >/dev/null 2>&1
waitfor "input[aria-label='Your callsign']" 20 || echo "FAIL: callsign screen never appeared"

echo "== callsign screen =="
$B screenshot "$TR/verify-callsign.png" >/dev/null 2>&1
$B find label "Your callsign" fill "TESTBOSS" >/dev/null 2>&1
sleep 1
$B find role button click --name "MOER IN" 2>/dev/null || $B find role button click --name "KLAAR" 2>/dev/null || \
  $B eval "document.querySelector('main button[type=\\'button\\'], main button')?.click()" >/dev/null 2>&1
waitfor "input[aria-label='6-letter session code']" 25 || echo "FAIL: hub never appeared"

echo "== hub screen =="
$B screenshot "$TR/verify-hub.png" >/dev/null 2>&1
# start a new session (first big button inside Session actions)
$B find first "section[aria-label='Session actions'] button" click >/dev/null 2>&1
sleep 2
echo "created modal:"
$B find text "Moer in" click 2>/dev/null || $B eval "[...document.querySelectorAll('button')].find(b=>/moer in/i.test(b.textContent||''))?.click()" >/dev/null 2>&1
waitfor "textarea[aria-label='Message']" 25 || echo "FAIL: chat screen never appeared"

echo "== chat screen: sending two messages =="
$B find label "Message" fill "Eerste toetslyn vir die nuwe borrels" >/dev/null 2>&1
sleep 0.5
$B find label "Send message" click >/dev/null 2>&1
sleep 2.5
$B find label "Message" fill "Tweede lyn — selfde groep, stert net op die laaste een" >/dev/null 2>&1
sleep 0.5
$B find label "Send message" click >/dev/null 2>&1
sleep 3

echo "== transcript html check =="
$B eval "(() => { const b=[...document.querySelectorAll('div[class*=rounded-\\[20px\\]]')]; const t=[...document.querySelectorAll('svg[viewBox=\\'0 0 10 10\\']')]; return JSON.stringify({bubbles:b.length, tails:t.length, firstBubble:b[0]?.className?.slice(0,120)||null}); })()" 2>/dev/null

$B screenshot "$TR/verify-chat.png" >/dev/null 2>&1

echo "== console + page errors =="
$B console 2>/dev/null | tail -12
$B errors 2>/dev/null | tail -8

echo "== dev nonce propagation (SSR html) =="
curl -s http://localhost:3000/ | grep -o 'nonce="[^"]*"' | head -2
curl -sI http://localhost:3000/ | grep -ci "content-security-policy" | sed 's/^/CSP header present: /'

$B close >/dev/null 2>&1
echo "== done =="
