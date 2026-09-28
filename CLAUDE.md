# Hinweise für Claude

Fork von dirkdrutschmann/srbasar-backend, beim NBBV die API der **Spielebörse** (https://nbbv-sr-basar.de/api/).
Server, Deploy und `.env`-Eigenheiten: Abschnitt „NBBV-Betrieb“ oben in der [README](README.md).
Gemeinsame Konventionen: CLAUDE.md im Repo Erikk87/nbbv-webservices.

- Arbeits-Branch ist `dev` (deployt nach `/opt/srbasar/dev`), auf `main` nur per PR von `dev` und nur auf
  ausdrückliche Anweisung – `main` geht sofort live.
- Upstream-Dateien nur wenn nötig ändern, damit Merges mit `upstream` einfach bleiben.
- `.env` nur auf dem Server. `UNIX_SENTMAIL` nicht „korrigieren“.
- Auf demselben Server läuft die unabhängige nbbv-spielplan-api (eigene PM2-Prozesse, eigene DBs). Sie darf
  nicht vom SR-Basar abhängen und umgekehrt. Die nginx-Config `sites-available/srbasar` enthält beide.
- Vor dem Commit `npm test`.
- Antworten und Kommentare auf Deutsch.
