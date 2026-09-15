#!/bin/bash
# E2E round 7: WANTED v3 (media RIGHT + huge, untraceable wire, 7d) + FBOEK.
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

ab close >/dev/null 2>&1
ab set viewport 1440 900
ab open http://localhost:3000
ab wait --load networkidle

echo "== gate + callsign =="
waitfor "input[aria-label='Access code']" 30 || { echo "FAIL gate"; ab screenshot "$TR/w7-gate-fail.png"; }
ab find label "Access code" fill "187"
NICK="W$((RANDOM*32768+RANDOM))"
waitfor "input[aria-label='Your callsign']" 20 && {
  ab find label "Your callsign" fill "$NICK"
  sleep 1
  ab eval "document.querySelector('main button')?.click()"
}

echo "== open WANTED board via desktop rail =="
waitfor "aside" 25
ab eval "[...document.querySelectorAll('aside button')].find(b=>b.textContent.includes('Wanted'))?.click()"
waitfor "section[aria-label='WANTED board']" 10
waitfor "button[aria-label='Build a WANTED case']" 15 || true
ab eval "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('BOU'))?.click()"
sleep 1

echo "== stage a photo exhibit =="
ab upload "input[aria-label='Attach images or videos']" /home/z/my-project/public/fast-logo.png
sleep 2
ab eval "[...document.querySelectorAll('img')].filter(i=>i.alt&&i.alt.startsWith('Exhibit')).length"

echo "== fill + seal the case =="
ab find label "Title" fill "TOETS SAAK 187"
ab find label "Description" fill "Bewysstuk vir die nuwe reg-uitleg: media regs, GROOT."
sleep 0.5
ab eval "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('SEEL')||b.textContent.includes('SEËL'))?.click()"
sleep 5

echo "== open the new case card =="
waitfor "[data-wcard]" 20
ab eval "document.querySelector('[data-wcard]')?.click()"
sleep 2

echo "== CASE FILE LAYOUT (exhibit must sit RIGHT + dominate) =="
cat > /tmp/layout.js << 'EOF'
(() => {
  const ex = document.querySelector("section[aria-label='Case exhibits']");
  const info = document.querySelector("section[aria-label='Case info and comments']");
  const img = ex ? ex.querySelector("img[alt^='Case exhibit']") : null;
  if (!ex || !info) return JSON.stringify({ ok: false, ex: !!ex, info: !!info });
  const eb = ex.getBoundingClientRect();
  const ib = info.getBoundingClientRect();
  return JSON.stringify({
    ok: true,
    exhibitRight: eb.left > ib.left + 40,
    exhibitWider: eb.width > ib.width,
    exhibitW: Math.round(eb.width),
    infoW: Math.round(ib.width),
    imgH: img ? Math.round(img.getBoundingClientRect().height) : null,
    imgCursorZoom: img ? getComputedStyle(img).cursor : null,
    gridCols: getComputedStyle(ex.parentElement).gridTemplateColumns,
    orderEx: getComputedStyle(ex).order,
    orderInfo: getComputedStyle(info).order,
    hasFullscreenBadge: !!ex.querySelector("span[aria-hidden]"),
    thumbCount: ex.querySelectorAll("button[aria-label^='Exhibit']").length,
  });
})()
EOF
ab eval "$(cat /tmp/layout.js)"
ab screenshot "$TR/w7-casefile-desktop.png"

echo "== lightbox =="
ab eval "document.querySelector(\"section[aria-label='Case exhibits'] img[alt^='Case exhibit'\])?.click()" 2>/dev/null || \
  ab eval "document.querySelector('img[alt^=\'Case exhibit\']')?.click()"
sleep 1
ab get count "[aria-label='Fullscreen exhibit']"
ab screenshot "$TR/w7-lightbox.png"
ab press Escape
sleep 0.5

echo "== wire untraceability probe (server list must carry NO creatorFp) =="
curl -s http://localhost:3000/api/wanted | head -c 700; echo
echo "--"
curl -s http://localhost:3000/api/wanted | grep -c creatorFp || true

echo "== close case, open FBOEK =="
ab press Escape
sleep 0.5
ab eval "[...document.querySelectorAll('aside button')].find(b=>b.textContent.includes('Fboek'))?.click()"
sleep 2
waitfor "a[href='https://www.facebook.com/groups/1145507374803204']" 15
cat > /tmp/fb.js << 'EOF'
(() => {
  const a = document.querySelector("a[href*='facebook.com/groups']");
  const title = document.querySelector(".gang-font");
  return JSON.stringify({
    href: a ? a.href : null,
    target: a ? a.target : null,
    rel: a ? a.rel : null,
    text: a ? a.textContent.trim().slice(0, 60) : null,
    screenTitle: title ? title.textContent : null,
    railHasFboek: !![...document.querySelectorAll("aside button")].find(b => b.textContent.includes("Fboek")),
  });
})()
EOF
ab eval "$(cat /tmp/fb.js)"
ab screenshot "$TR/w7-fboek-desktop.png"

echo "== mobile: dock has 5 tabs + case media stacks on top =="
ab set viewport 390 844
sleep 1
ab eval "[...document.querySelectorAll('nav button')].map(b=>b.textContent.trim()).join('|')"
ab eval "[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Wanted'))?.click()"
sleep 2
ab eval "document.querySelector('[data-wcard]')?.click()"
sleep 2
cat > /tmp/mob.js << 'EOF'
(() => {
  const ex = document.querySelector("section[aria-label='Case exhibits']");
  const info = document.querySelector("section[aria-label='Case info and comments']");
  if (!ex || !info) return JSON.stringify({ ok: false });
  const eb = ex.getBoundingClientRect();
  const ib = info.getBoundingClientRect();
  return JSON.stringify({
    ok: true,
    galleryFirst: eb.top < ib.top,
    galleryW: Math.round(eb.width),
    vw: window.innerWidth,
    dockTabs: document.querySelectorAll("nav[aria-label='Primary'] button").length,
  });
})()
EOF
ab eval "$(cat /tmp/mob.js)"
ab screenshot "$TR/w7-casefile-mobile.png"

echo "== console (last 8) =="
ab console | tail -8
echo "== page errors =="
ab errors | tail -8
ab close
echo "== dev.log tail =="
tail -6 dev.log
echo "== done =="
