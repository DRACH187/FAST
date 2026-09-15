#!/bin/bash
# Task 19 — navigation shell E2E: mobile dock + desktop rail + chat golden path.
# Fresh named browser session (the default profile carries a stale identity).
set -u
cd /home/z/my-project
export AGENT_BROWSER_SESSION="t19-$RANDOM"
TR=/home/z/my-project/tool-results
ab() { timeout 25 agent-browser "$@" 2>/dev/null || true; }
waitfor() {
  for i in $(seq 1 "${3:-15}"); do
    n=$(ab get count "$2" 2>/dev/null | tr -dc '0-9')
    [ "${n:-0}" -ge 1 ] && return 0
    sleep 1
  done
  return 1
}
# the dock is the LAST Primary nav in the DOM (the desktop rail also has one,
# hidden on mobile) — click tabs through it
DOCK_EVAL='(() => { const navs=[...document.querySelectorAll("nav[aria-label='"'"'Primary'"'"']")]; const nav=navs[navs.length-1]; if(!nav) return "no-dock"; return navs.length; })()'
dock_tab() { # $1 = label regex
  ab eval "(() => { const navs=[...document.querySelectorAll(\"nav[aria-label='Primary']\")]; const nav=navs[navs.length-1]; if(!nav) return 'no-dock'; const b=[...nav.querySelectorAll('button')].find(x=>/$1/i.test(x.textContent||'')); if(!b) return 'no-tab'; b.click(); return 'ok'; })()"
}
setsid sh -c 'bun run dev > dev.log 2>&1 < /dev/null' &
for i in $(seq 1 45); do
  sleep 1
  c=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true)
  [ "$c" = "200" ] && break
done
echo "== server up: $c =="

# ---------------- MOBILE 390x844 ----------------
ab set viewport 390 844
ab open http://localhost:3000
ab wait --load networkidle
waitfor ab "input[aria-label='Access code']" 30 || echo "FAIL gate"
sleep 1
ab find label "Access code" fill "187"
waitfor ab "input[aria-label='Your callsign']" 20 || echo "FAIL callsign screen"
NICK="TS$((RANDOM*32768+RANDOM))"
ab find label "Your callsign" fill "$NICK"
sleep 0.5
ab eval "document.querySelector('main button')?.click()"
waitfor ab "input[aria-label='6-letter session code']" 25 || echo "FAIL hub"
sleep 1.2
ab screenshot "$TR/t19-hub-mobile.png"
echo "dock tabs: $(ab get count "nav[aria-label='Primary']:last-of-type button" | tr -dc '0-9')"

dock_tab wanted
waitfor ab "[aria-label='WANTED board']" 12 && echo "WANTED tab OK" || echo "FAIL wanted"
sleep 1
ab screenshot "$TR/t19-wanted-mobile.png"
dock_tab kaart
waitfor ab "[aria-label='Surroundings map']" 12 && echo "MAP tab OK" || echo "FAIL map"
sleep 1
ab screenshot "$TR/t19-map-mobile.png"
dock_tab live
waitfor ab "[aria-label='Live operatives']" 12 && echo "LIVE tab OK" || echo "FAIL live"
sleep 0.8
ab screenshot "$TR/t19-live-mobile.png"
dock_tab werwe
waitfor ab "input[aria-label='6-letter session code']" 12 && echo "WERWE tab OK" || echo "FAIL werwe"

# golden path: create session -> chat -> 2 messages
ab find first "section[aria-label='Session actions'] button" click
sleep 1.5
ab eval "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Moer in')?.click()"
waitfor ab "textarea[aria-label='Message']" 25 || echo "FAIL chat"
echo "dock in chat: $(ab get count "nav[aria-label='Primary']:last-of-type" | tr -dc '0-9') (want 0)"
ab find label "Message" fill "Eerste lyn vir die nuwe borrels"
ab find label "Send message" click
sleep 1
ab find label "Message" fill "Tweede lyn — selfde groep"
ab find label "Send message" click
sleep 2
cat > /tmp/bubble19.js << 'EOF'
(() => {
  const bubbles = [...document.querySelectorAll('div')].filter(d => typeof d.className === 'string' && d.className.includes('rounded-[20px]'));
  const tails = [...document.querySelectorAll("svg[viewBox='0 0 10 10']")];
  return JSON.stringify({ bubbles: bubbles.length, tails: tails.length, mine: bubbles.filter(b => b.className.includes('bg-white')).length });
})()
EOF
ab eval "$(cat /tmp/bubble19.js)"
ab screenshot "$TR/t19-chat-mobile.png"
ab find label "Back to sessions" click
waitfor ab "input[aria-label='6-letter session code']" 12 && echo "BACK to hub OK" || echo "FAIL back"

# ---------------- DESKTOP 1440x900 (gate first, fresh identity) ----------------
ab set viewport 1440 900
ab reload
ab wait --load networkidle
waitfor ab "input[aria-label='Access code']" 30 || echo "FAIL desktop gate"
sleep 1
ab find label "Access code" fill "187"
waitfor ab "input[aria-label='6-letter session code']" 25 || echo "FAIL desktop hub"
sleep 1.2
echo "rail present: $(ab get count "aside[aria-label='Primary']" | tr -dc '0-9') (want 1)"
echo "rail nav rows: $(ab get count "aside[aria-label='Primary'] nav button" | tr -dc '0-9')"
ab screenshot "$TR/t19-hub-desktop.png"
ab eval "[...document.querySelectorAll(\"aside[aria-label='Primary'] nav button\")].find(b=>/wanted/i.test(b.textContent||''))?.click()"
waitfor ab "[aria-label='WANTED board']" 12 && echo "DESKTOP WANTED pane OK" || echo "FAIL desktop wanted"
sleep 1
ab screenshot "$TR/t19-wanted-desktop.png"
ab eval "[...document.querySelectorAll(\"aside[aria-label='Primary'] nav button\")].find(b=>/kaart/i.test(b.textContent||''))?.click()"
waitfor ab "[aria-label='Surroundings map']" 12 && echo "DESKTOP MAP pane OK" || echo "FAIL desktop map"
sleep 1
ab screenshot "$TR/t19-map-desktop.png"
ab eval "[...document.querySelectorAll(\"aside[aria-label='Primary'] nav button\")].find(b=>/werwe/i.test(b.textContent||''))?.click()"
waitfor ab "input[aria-label='6-letter session code']" 12 && echo "DESKTOP WERWE OK" || echo "FAIL desktop werwe"
ab find first "section[aria-label='Session actions'] button" click
sleep 1.5
ab eval "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Moer in')?.click()"
waitfor ab "textarea[aria-label='Message']" 25 && echo "DESKTOP chat open OK" || echo "FAIL desktop chat"
echo "rail persists in chat: $(ab get count "aside[aria-label='Primary']" | tr -dc '0-9') (want 1)"
sleep 1
ab screenshot "$TR/t19-chat-desktop.png"
ab close
echo "== done =="
