#!/bin/bash
# E2E round 7b: focused probes — lightbox, layout JSON, FBOEK link, wire probe.
set -u
cd /home/z/my-project
TR=/home/z/my-project/tool-results
ab() { timeout 20 agent-browser "$@" 2>/dev/null || true; }

waitfor() {
  for i in $(seq 1 "${2:-12}"); do
    n=$(ab get count "$1" | tr -dc '0-9')
    [ "${n:-0}" -ge 1 ] && return 0
    sleep 1
  done
  return 1
}

code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true)
if [ "$code" != "200" ]; then
  setsid sh -c 'cd /home/z/my-project && bun run dev > dev.log 2>&1 < /dev/null' &
  for i in $(seq 1 40); do sleep 1; code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true); [ "$code" = "200" ] && break; done
fi
echo "== server: HTTP $code =="

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

echo "== layout JSON =="
ab eval "$(cat << 'EOF'
(() => {
  const ex = document.querySelector("section[aria-label='Case exhibits']");
  const info = document.querySelector("section[aria-label='Case info and comments']");
  if (!ex || !info) return JSON.stringify({ ok: false });
  const eb = ex.getBoundingClientRect();
  const ib = info.getBoundingClientRect();
  const img = ex.querySelector("img[alt^='Case exhibit']");
  return JSON.stringify({
    exhibitRight: eb.left > ib.left + 40,
    exhibitWider: eb.width > ib.width,
    exhibitW: Math.round(eb.width),
    infoW: Math.round(ib.width),
    imgH: img ? Math.round(img.getBoundingClientRect().height) : null,
    zoomCursor: img ? getComputedStyle(img).cursor : null,
    gridCols: getComputedStyle(ex.parentElement).gridTemplateColumns,
    thumbCount: ex.querySelectorAll("button[aria-label^='Exhibit']").length,
  });
})()
EOF
)"

echo "== lightbox probe =="
ab eval "document.querySelector(\"img[alt^='Case exhibit']\")?.click()"
sleep 1
cat > /tmp/lb.js << 'EOF'
(() => {
  const lb = document.querySelector("[aria-label='Fullscreen exhibit']");
  if (!lb) return JSON.stringify({ open: false });
  const img = lb.querySelector("img");
  const b = img ? img.getBoundingClientRect() : null;
  return JSON.stringify({
    open: true,
    isVideo: !!lb.querySelector("video"),
    imgH: b ? Math.round(b.height) : null,
    imgW: b ? Math.round(b.width) : null,
    coversViewport: lb.getBoundingClientRect().width === window.innerWidth,
    caption: lb.textContent.includes("AES-256-GCM"),
  });
})()
EOF
ab eval "$(cat /tmp/lb.js)"
ab screenshot "$TR/w7b-lightbox.png"
ab press Escape
sleep 0.5
ab eval "!!document.querySelector('[aria-label=\'Fullscreen exhibit\']')"

echo "== sakboek comment roundtrip (sealed-tag authorship) =="
ab find label "Write in the sakboek" fill "Eerste note — toets die sakboek."
ab eval "[...document.querySelectorAll('form button')].find(b=>b.getAttribute('type')==='submit')?.click()"
sleep 3
ab eval "document.querySelector('li .text-\\\\[13px\\\\]')?.textContent"

echo "== close + FBOEK probe =="
ab press Escape; sleep 0.5
ab eval "[...document.querySelectorAll('aside button')].find(b=>b.textContent.includes('Fboek'))?.click()"
sleep 2
ab eval "$(cat << 'EOF'
(() => {
  const a = document.querySelector("a[href*='facebook.com/groups']");
  return JSON.stringify({
    href: a ? a.getAttribute("href") : null,
    target: a ? a.target : null,
    hasNoopener: a ? (a.rel || "").includes("noopener") : false,
    ctaText: a ? a.textContent.trim().slice(0, 40) : null,
    points: document.body.textContent.includes("HOEOM JY IN DIE GROEP HOORT"),
    law: document.body.textContent.includes("BUITE die kluis"),
  });
})()
EOF
)"
ab screenshot "$TR/w7b-fboek.png"

echo "== wire untraceability (must be 0 creatorFp) =="
curl -s http://localhost:3000/api/wanted > /tmp/wire.json
head -c 400 /tmp/wire.json; echo
echo "creatorFp count: $(grep -o creatorFp /tmp/wire.json | wc -l)"
echo "expiresAt sample: $(grep -o '"expiresAt":"[^"]*"' /tmp/wire.json | head -1)"

echo "== errors =="
ab errors | tail -6
ab close
echo "== done =="
