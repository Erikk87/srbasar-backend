#!/usr/bin/env bash
# Läuft beim Deploy auf dem Server im App-Ordner (aufgerufen von .github/workflows/deploy.yml):
# Node-Version aus .nvmrc wählen, Abhängigkeiten installieren, migrieren und den PM2-Prozess
# neu laden. Wechselt die Node-Version, wird der Prozess einmal neu angelegt (kurze Pause),
# weil "pm2 reload" den bisherigen Interpreter behält.
#
#   bash ops/server-deploy.sh <pm2-name> <startdatei> <migrationsskript> [weitere Optionen für pm2 start]
set -euo pipefail
name="$1"; start="$2"; migrate="$3"; shift 3

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
# PM2 ist global unter der Standard-Version installiert: Pfad merken, bevor die Version wechselt
pm2="$(command -v pm2)"
# Version aus .nvmrc, nur bei Bedarf installieren (sonst würde jeder Deploy die neueste Unterversion holen)
nvm use >/dev/null 2>&1 || nvm install >/dev/null
node_bin="$(nvm which current)"
echo "Node $(node -v) für $name"

npm ci --omit=dev --no-audit --no-fund
node "$migrate"

aktuell="$("$pm2" jlist | node -e 'const l = JSON.parse(require("fs").readFileSync(0, "utf8")); const p = l.find(x => x.name === process.argv[1]); process.stdout.write(p ? String(p.pm2_env.exec_interpreter || "") : "")' "$name")"
neu_anlegen() {
  "$pm2" start "$start" --name "$name" --cwd "$PWD" --interpreter "$node_bin" "$@"
  "$pm2" save
}
if [ -z "$aktuell" ]; then
  neu_anlegen "$@"
elif [ "$aktuell" = "$node_bin" ]; then
  "$pm2" reload "$name" --update-env
else
  echo "Node-Version wechselt ($aktuell -> $node_bin): Prozess wird neu angelegt"
  "$pm2" delete "$name"
  neu_anlegen "$@"
fi
