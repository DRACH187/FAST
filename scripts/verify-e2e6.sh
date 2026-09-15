#!/bin/bash
# E2E round 6: two-tab OPEN VUUR cross-decryption + map initial fit.
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

enter_app() {  # gate + callsign
  ab open http://localhost:3000 >/dev/null
  ab wait --load networkidle
  sleep 1
  ab eval "document.querySelector('button[aria-label*=\"TIK\"]')?.click(); 'ok'" >/dev/null
  waitfor "input[aria-label='Access code']" 25 || echo "FAIL gate"
  ab find label "Access code" fill "187"
  waitfor "input[aria-label='Your callsign']" 20 || return 1
  ab find label "Your callsign" fill "$1"
  sleep 1
  ab eval "document.querySelector('main button')?.click(); 'ok'" >/dev/null
  waitfor "section[aria-label='Open Vuur public room']" 25
}

open_vuur() {
  ab find first "section[aria-label='Open Vuur public room'] button" click
  waitfor "textarea[aria-label='Message']" 25
}

# ---- tab 1: sender
ab set viewport 390 844
enter_app "TSX$((RANDOM*32768+RANDOM))" || echo "FAIL tab1 enter"
open_vuur || echo "FAIL tab1 vuur"
ab find label "Message" fill "Twee tabbes — een vuur, een sleutel"
sleep 0.5
ab find label "Send message" click
sleep 2.5

# ---- tab 2: fresh identity, fresh device, same derived key
ab open tab2 http://localhost:3000 >/dev/null 2>&1 || true
enter_app "TSY$((RANDOM*32768+RANDOM))" || echo "FAIL tab2 enter"
open_vuur || echo "FAIL tab2 vuur"
sleep 3

echo "== tab2 sees tab1's message? =="
ab eval "[...document.querySelectorAll('div')].filter(d=>typeof d.className==='string'&&d.className.includes('rounded-[20px]')).map(d=>d.textContent.slice(0,80))"

echo "== tab2 live count (should be 2 in room) =="
ab eval "document.querySelector('header')?.textContent?.match(/(\\d+) LIVE|SOLO/)?.[0]"

ab screenshot "$TR/verify-openvuur-tab2.png"
echo "== errors =="
ab errors | tail -6
ab close
echo "== done =="
