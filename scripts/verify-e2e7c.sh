#!/bin/bash
# E2E round 7c: sakboek comment roundtrip (holder-nonce comment path).
set -u
cd /home/z/my-project
TR=/home/z/my-project/tool-results
ab() { timeout 20 agent-browser "$@" 2>/dev/null || true; }
waitfor() { for i in $(seq 1 "${2:-12}"); do n=$(ab get count "$1" | tr -dc '0-9'); [ "${n:-0}" -ge 1 ] && return 0; sleep 1; done; return 1; }

code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true)
if [ "$code" != "200" ]; then
  setsid sh -c 'cd /home/z/my-project && bun run dev > dev.log 2>&1 < /dev/null' &
  for i in $(seq 1 40); do sleep 1; code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true); [ "$code" = "200" ] && break; done
fi

ab close >/dev/null 2>&1
ab set viewport 1440 900
ab open http://localhost:3000
ab wait --load networkidle
waitfor "input[aria-label='Access code']" 30 || echo "FAIL gate"
ab find label "Access code" fill "187"
waitfor "input[aria-label='Your callsign']" 20 && {
  ab find label "Your callsign" fill "W$((RANDOM*32768+RANDOM))"
  sleep 1
  ab eval "document.querySelector('main button')?.click()"
}
sleep 2
ab eval "[...document.querySelectorAll('aside button')].find(b=>b.textContent.includes('Wanted'))?.click()"
waitfor "[data-wcard]" 20 || echo "no cards"
ab eval "document.querySelector('[data-wcard]')?.click()"
sleep 2

echo "== post a sakboek note =="
waitfor "input[aria-label='Write in the sakboek']" 10 || echo "FAIL sakboek input"
ab find label "Write in the sakboek" fill "Eerste note in die sakboek — ongesien, ongespoor."
sleep 0.5
ab eval "(() => { const f=document.querySelector(\"section[aria-label='Case info and comments'] form\"); const b=f&&f.querySelector('button[type=submit],button:not([type])'); if(b){b.click();return 'clicked';} return 'no-button'; })()"
sleep 3

echo "== note visible in DOM? =="
ab eval "(() => { const lis=[...document.querySelectorAll('section[aria-label=\\'Case info and comments\\'] li')]; return JSON.stringify({ notes: lis.length, text: lis.length? lis[0].textContent.slice(0,90):null }); })()"

echo "== note on the wire (shape check: id/iv/ciphertext/createdAt ONLY)? =="
sleep 1
curl -s http://localhost:3000/api/wanted | python3 -c "
import json,sys
d=json.load(sys.stdin)
for p in d.get('posts', []):
    for c in p.get('comments', []):
        print('comment keys:', sorted(c.keys()))
        print('comment id len:', len(c['id']))
"

echo "== dev.log recent wanted posts =="
tail -40 dev.log | grep "POST /api/wanted" | tail -3
ab screenshot "$TR/w7c-sakboek.png"
ab close
echo "== done =="
