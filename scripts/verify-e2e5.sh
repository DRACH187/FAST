#!/bin/bash
# E2E round 5: Poese removal + OPEN VUUR public room + custom map + data vault.
# Assumes the dev server is ALREADY running on :3000 (no duplicate instance).
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

ab set viewport 390 844
ab open http://localhost:3000
ab wait --load networkidle
sleep 1

# skip splash if present
ab eval "document.querySelector('button[aria-label*=\"TIK\"], .fixed.inset-0 button')?.click(); 'ok'" >/dev/null

waitfor "input[aria-label='Access code']" 25 || echo "FAIL gate"
ab find label "Access code" fill "187"
waitfor "input[aria-label='Your callsign']" 20 && {
  NICK="TS$((RANDOM*32768+RANDOM))"; ab find label "Your callsign" fill "$NICK"
  sleep 1
  ab eval "document.querySelector('main button')?.click()"
}

waitfor "section[aria-label='Open Vuur public room']" 25 || echo "FAIL open-vuur-card"
echo "== OPEN VUUR card visible =="

echo "== dock tab count (Poese must be gone; expect 4) =="
ab eval "[...document.querySelectorAll('nav button')].map(b=>b.textContent.trim()).join('|')"

echo "== entering OPEN VUUR =="
ab find first "section[aria-label='Open Vuur public room'] button" click
waitfor "textarea[aria-label='Message']" 25 || echo "FAIL public chat"

echo "== public chat header =="
ab eval "document.querySelector('header .font-mono.text-base')?.textContent?.trim()"

ab find label "Message" fill "Oop vuur eerste skoot — elke ouen sien dit"
sleep 0.5
ab find label "Send message" click
sleep 3

echo "== public bubble check =="
ab eval "[...document.querySelectorAll('div')].filter(d=>typeof d.className==='string'&&d.className.includes('rounded-[20px]')).length"

echo "== TTL chip (rolling wipe) in header =="
ab eval "document.querySelector('header')?.textContent?.includes('VEE') || document.querySelector('header')?.textContent?.match(/\\d{2}:\\d{2}/)?.[0] || 'no-ttl'"

echo "== console errors so far =="
ab errors | tail -5
ab screenshot "$TR/verify-openvuur.png"

echo "== back to hub, then MAP =="
ab eval "document.querySelector('header button[aria-label=\"Back to sessions\"]')?.click(); 'ok'" >/dev/null
sleep 1
ab eval "[...document.querySelectorAll('nav button')].find(b=>/Kaart/i.test(b.textContent))?.click(); 'ok'" >/dev/null
waitfor "svg[role='img']" 20 || echo "FAIL custom map svg"
echo "== map: iframe count (must be 0) + svg paths =="
ab eval "({iframes: document.querySelectorAll('iframe').length, paths: document.querySelectorAll('svg[role=\\'img\\'] path').length, labels: [...document.querySelectorAll('svg[role=\\'img\\'] text')].map(t=>t.textContent).filter(t=>t==='187').length})"
ab screenshot "$TR/verify-map3.png"

echo "== profile DATA-KLUIS =="
ab eval "document.querySelector('header button[aria-label=\"Close map\"]')?.click(); 'ok'" >/dev/null
sleep 1
ab eval "[...document.querySelectorAll('button')].find(b=>/Profiel|JOU MERK|profile/i.test(b.getAttribute('aria-label')||''))?.click(); 'ok'" >/dev/null
sleep 1.5
ab eval "[...document.querySelectorAll('p,span')].some(e=>/DATA-KLUIS/.test(e.textContent)) ? 'vault-panel-ok' : 'vault-panel-missing'"
ab screenshot "$TR/verify-vault.png"

echo "== console (last 12) =="
ab console | tail -12
echo "== page errors =="
ab errors | tail -8
ab close
echo "== done =="
