#!/bin/bash
# Final gate visuals: settled entrance + desktop viewport.
set -u
cd /home/z/my-project
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
setsid sh -c 'bun run dev > dev.log 2>&1 < /dev/null' &
for i in $(seq 1 40); do
  sleep 1
  c=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true)
  [ "$c" = "200" ] && break
done
echo "== server up: $c =="

ab set viewport 390 844
ab open http://localhost:3000
ab wait --load networkidle
waitfor ab "input[aria-label='Access code']" 25
sleep 3.5
ab screenshot "$TR/v6-gate-mobile.png"
ab find label "Access code" fill "18"
sleep 1.2
ab screenshot "$TR/v6-gate-typing.png"

ab set viewport 1440 900
ab reload
ab wait --load networkidle
sleep 3.5
ab screenshot "$TR/v6-gate-desktop.png"
ab close
echo "== done =="
