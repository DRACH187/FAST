#!/bin/bash
# One-shot E2E round 5: member chat flow + DRACH/BIGBOSS27 boss flow.
set -u
cd /home/z/my-project
TR=/home/z/my-project/tool-results
ab() { timeout 25 agent-browser "$@" 2>/dev/null || true; }
abb() { timeout 25 agent-browser --session boss "$@" 2>/dev/null || true; }

waitfor() { # waitfor <fn> <css> <secs>
  local fn="$1" css="$2" secs="${3:-15}"
  for i in $(seq 1 "$secs"); do
    n=$($fn get count "$css" 2>/dev/null | tr -dc '0-9')
    [ "${n:-0}" -ge 1 ] && return 0
    sleep 1
  done
  return 1
}

setsid sh -c 'bun run dev > dev.log 2>&1 < /dev/null' &
code=000
for i in $(seq 1 40); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true)
  [ "$code" = "200" ] && break
done
echo "== server ready: HTTP $code =="

FP=$(openssl rand -hex 32)
echo "== boss API: DRACH + BIGBOSS27 =="
curl -s -X POST http://localhost:3000/api/identity -H "Content-Type: application/json" \
  -d "{\"fingerprint\":\"$FP\",\"nickname\":\"DRACH\",\"bossKey\":\"BIGBOSS27\"}" | head -c 220; echo
echo "== boss API: DRACH + wrong key (expect refusal) =="
curl -s -X POST http://localhost:3000/api/identity -H "Content-Type: application/json" \
  -d "{\"fingerprint\":\"$(openssl rand -hex 32)\",\"nickname\":\"DRACH\",\"bossKey\":\"WRONGKEY99\"}" | head -c 160; echo
echo "== boss API: weak new secret still rejected (validation alive) =="
curl -s -o /dev/null -w "gate with passcode '1234567890' -> %{http_code}\n" -X POST http://localhost:3000/api/gate \
  -H "Content-Type: application/json" -d '{"passcode":"1234567890"}'

# --------------------------------------------------------- member session
ab set viewport 390 844
ab open http://localhost:3000
ab wait --load networkidle
waitfor ab "input[aria-label='Access code']" 25 || echo "FAIL gate"
ab screenshot "$TR/v5-gate.png"
ab find label "Access code" fill "187"
waitfor ab "input[aria-label='Your callsign']" 20 && {
  ab find label "Your callsign" fill "TS$((RANDOM*32768+RANDOM))"
  sleep 1
  ab eval "document.querySelector('main button')?.click()"
}
waitfor ab "input[aria-label='6-letter session code']" 25 || echo "FAIL hub"
ab find first "section[aria-label='Session actions'] button" click
sleep 2
ab eval "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Moer in')?.click()"
waitfor ab "textarea[aria-label='Message']" 25 || echo "FAIL chat"
ab find label "Message" fill "Eerste lyn vir die nuwe borrels"
sleep 0.5
ab find label "Send message" click
sleep 3
ab find label "Message" fill "Tweede lyn — selfde groep"
sleep 0.5
ab find label "Send message" click
sleep 3.5

cat > /tmp/bubble.js << 'EOF'
(() => {
  const bubbles = [...document.querySelectorAll('div')].filter(d => typeof d.className === 'string' && d.className.includes('rounded-[20px]'));
  const tails = [...document.querySelectorAll("svg[viewBox='0 0 10 10']")];
  return JSON.stringify({ bubbles: bubbles.length, tails: tails.length, mine: bubbles.filter(b => b.className.includes('bg-white')).length });
})()
EOF
echo "== member bubble stats =="
ab eval "$(cat /tmp/bubble.js)"
ab screenshot "$TR/v5-chat.png"

# --------------------------------------------------------- boss UI session
abb set viewport 390 844
abb open http://localhost:3000
abb wait --load networkidle
waitfor abb "input[aria-label='Access code']" 25 || echo "FAIL boss gate"
abb find label "Access code" fill "187"
waitfor abb "input[aria-label='Your callsign']" 20 || echo "FAIL boss callsign"
abb find label "Your callsign" fill "DRACH"
sleep 1.2
echo "== boss key field revealed =="
abb get count "input[aria-label='Boss key']" | tr -dc '0-9' | sed 's/^/boss key inputs: /'
abb screenshot "$TR/v5-drach.png"
abb find label "Boss key" fill "BIGBOSS27"
sleep 0.5
abb eval "document.querySelector('main button')?.click()"
waitfor abb "input[aria-label='6-letter session code']" 25 || echo "FAIL boss hub"
sleep 1.5
echo "== boss hub assertions =="
abb eval "(() => { const t=document.body.innerText; return JSON.stringify({ werfRol: t.includes('DIE WERF ROL'), summon: t.includes(\"MOER 'N WERF UIT\"), drach: /DRACH/i.test(t) }); })()" 2>/dev/null
abb screenshot "$TR/v5-bosshub.png"

echo "== main session console errors =="
ab console 2>/dev/null | grep -ciE "csp|violat|error" | sed 's/^/console csp\/error lines: /'
ab errors 2>/dev/null | tail -5
echo "== nonce in SSR html =="
curl -s http://localhost:3000/ | grep -o 'nonce="[^"]*"' | head -1
ab close; abb close
echo "== done =="
