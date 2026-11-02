# Audit der Produktionsabhängigkeiten

Stand 02.11.2026. Der Schritt `npm run audit:production` in `ci-cd.yml` schlägt bei `high` und `critical` fehl.

| | kritisch | hoch | mittel |
|---|---|---|---|
| vorher | 2 | 11 | 16 |
| nachher | 0 | 0 | 11 |

`npm run audit:production` ist grün. `nodemailer` ist auf 10 aktualisiert; eine echte Mail über SMTP wurde dabei nicht getestet.

## Behoben

Nur Versionen innerhalb der bestehenden Bereiche, keine Herabstufung, keine neuen Pakete.

| Paket | Version | Im Betrieb erreichbar? |
|---|---|---|
| `body-parser` | 1.20.8 → 1.20.9 | **Ja.** `express.json()` entpackt komprimierte Anfragen an der öffentlichen API. |
| `morgan` | 1.12.0 → 1.12.1 | Ja, Log-Injection über Anfragefelder, geringe Wirkung. |
| `follow-redirects` | 1.16.0 → 1.16.2 | Kaum. Die Abrufe setzen keinen `Authorization`-Header, der Login bei TeamSL läuft mit `maxRedirects: 0`. |
| `handlebars` | 4.7.9 → 4.7.10 | Nein. Kompiliert wird nur `templates/email/base.hbs` aus dem Repo, keine fremde Vorlage, keine vorkompilierte. Die gerenderte Mail ist unverändert. |
| `proxy-addr` | 2.0.7 → 2.0.8 | Nein. Die App setzt kein `trust proxy` und wertet `req.ip` nicht aus. |
| `brace-expansion`, `fast-uri`, `moment`, `qs` | Patch | Nicht einzeln vertieft, da ohne Risiko aktualisierbar. |

Vorsicht: `npm audit fix` ist hier ungeeignet. Es stuft Pakete herunter, um Meldungen loszuwerden
(`swagger-jsdoc` 6.3.0 → 6.2.8, `rimraf` 2.7.1 → 2.2.8, `sequelize-cli` 6.6.5 → 6.6.2). Stattdessen gezielt
`npm update <paket>` verwenden. Auch die vorgeschlagenen Ziele `exceljs@3.4.0` und `sequelize@3.30.0` sind Herabstufungen.

## `pm2` ist nur noch Entwicklungsabhängigkeit

Damit entfallen `pm2`, `@pm2/agent`, `proxy-agent`, `pac-proxy-agent`, `get-uri` und `basic-ftp` aus dem Produktions-Audit.

- Die App lädt `pm2` nicht. Das einzige `require` steht in `ops/disableDeployWatch.js`, das nur der Deploy-Job des
  Originals im Original-Repo aufruft.
- `ops/server-deploy.sh` nimmt das global installierte PM2 (`command -v pm2`), bevor es `npm ci --omit=dev` ausführt.
- `test/deployWatch.test.js` braucht das Paket weiterhin, in der CI wird es mit installiert.

Auf dem Server und im Projekt läuft seit dem 02.11.2026 PM2 7.1.1. Das Audit prüft das globale PM2 nicht, Updates also von Hand nachziehen.

## Verbleibende Treffer

### Mittel, blockieren die CI nicht

| Paket | Über | Erreichbar? | Lösung |
|---|---|---|---|
| `uuid` 8.3.2 | `sequelize`, `exceljs` | Nein. Der Fehler betrifft v3, v5 und v6 mit `buf`, verwendet werden v1 und v4 ohne `buf`. | Beide sind auf dem neuesten Stand. Sequelize 7 ist noch Alpha. |
| `archiver`, `archiver-utils`, `zip-stream`, `readdir-glob` | `exceljs` | Nein. Das ist der Schreibpfad, die App liest nur (`xlsx.load`). | `exceljs` 4.4.0 ist die neueste Version. |
| `glob`, `minimatch`, `rimraf` | `swagger-jsdoc`, `exceljs` | Nein. Muster sind fest (`./src/routes/*.js`), kein Abbruch per `AbortSignal`. | `swagger-jsdoc` 6.3.0 ist die neueste Version. |

## Plan für die Major-Updates

1. **`exceljs`, `sequelize`, `swagger-jsdoc`: kein Update vorhanden.** Bei jedem neuen Release erneut prüfen. Falls die Meldungen
   stören, wäre ein Override für `uuid` möglich, das aber eigene Tests braucht und derzeit keinen Nutzen hat.

## Prüfung

- Die Prüfungen liefen unter Node 26 (lokal), die CI und der Deploy testen unter Node 24.
- Simulierte Produktionsinstallation (`npm ci --omit=dev`): kein `node_modules/pm2`, außer `pm2` selbst sind alle
  in `src` und `ops` per `require` geladenen Pakete auflösbar, `src/app.js` besteht `node --check`.
