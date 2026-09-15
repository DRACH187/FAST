#!/bin/bash
# One-shot E2E round 2: enter chat, send 2 messages, inspect bubble DOM.
set -u
cd /home/z/my-project
TR=/home/z/my-project/tool-results
ab() { timeout 25 agent-browser "$@" 2>/dev/null || true; }

waitfor() {
  for i in $(seq 1 "${2:-15}"); do
    n=$(ab get count "$1" | tr -dc '0-9')
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

ab set viewport 390 844
ab open http://localhost:3000
ab wait --load networkidle

waitfor "input[aria-label='Access code']" 25 || echo "FAIL gate"
ab find label "Access code" fill "187"
waitfor "input[aria-label='Your callsign']" 20 && {
  NICK="TS$((RANDOM*32768+RANDOM))"; ab find label "Your callsign" fill "$NICK"
  sleep 1
  ab eval "document.querySelector('main button')?.click()"
}
waitfor "input[aria-label='6-letter session code']" 25 || echo "FAIL hub"
ab find first "section[aria-label='Session actions'] button" click
sleep 2
ab eval "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Moer in')?.click()"
waitfor "textarea[aria-label='Message']" 25 || echo "FAIL chat"

echo "== sending two messages =="
ab find label "Message" fill "Eerste toetslyn vir die nuwe borrels"
sleep 0.5
ab find label "Send message" click
sleep 3
ab find label "Message" fill "Tweede lyn — selfde groep, stert net op die laaste een"
sleep 0.5
ab find label "Send message" click
sleep 3.5

cat > /tmp/bubble.js << 'EOF'
(() => {
  const bubbles = [...document.querySelectorAll('div')].filter(d => typeof d.className === 'string' && d.className.includes('rounded-[20px]'));
  const tails = [...document.querySelectorAll("svg[viewBox='0 0 10 10']")];
  const mine = bubbles.filter(b => b.className.includes('bg-white')).length;
  const groupedCorners = bubbles.filter(b => b.className.includes('-lg')).length;
  const chips = [...document.querySelectorAll('span')].filter(s => typeof s.className === 'string' && s.className.includes('size-5') && s.className.includes('rounded-md')).length;
  return JSON.stringify({
    bubbles: bubbles.length,
    tails: tails.length,
    myBubbles: mine,
    groupedCorners,
    senderChips: chips,
    sampleClass: bubbles[0] ? bubbles[0].className.slice(0, 150) : null,
  });
})()
EOF

echo "== bubble DOM stats =="
ab eval "$(cat /tmp/bubble.js)"
ab screenshot "$TR/verify-chat2.png"
echo "== console (last 12) =="
ab console | tail -12
echo "== page errors =="
ab errors | tail -10
echo "== nonce in SSR html =="
curl -s http://localhost:3000/ | grep -o 'nonce="[^"]*"' | head -2
ab close
echo "== done =="
