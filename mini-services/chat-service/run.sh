#!/usr/bin/env bash
# Supervisor: keeps the FAST relay alive, logging any crash.
cd "$(dirname "$0")"
while true; do
  echo "[supervisor] starting relay $(date +%T)"
  node relay.mjs
  echo "[supervisor] relay exited code=$? at $(date +%T)"
  sleep 1
done
