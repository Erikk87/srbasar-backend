# Srbasar Backend

Express.js Backend mit Sequelize und SQLite für das Srbasar-System zur Verwaltung von Basketball-Spielen und Schiedsrichtern.

Das eigenständige [Ballers-Club-Modul](docs/ballersclub.md) ergänzt den Basar um
offene Turniere aus Google Sheets, eine separate ENV und dauerhafte Hallen-Mappings.

## 🚀 Schnellstart

### Voraussetzungen

- Node.js (Version 16 oder höher)
- npm oder yarn

### Installation

```bash
# Repository klonen
git clone <repository-url>
cd srbasar-backend

# Abhängigkeiten installieren
npm install

# Umgebungsvariablen konfigurieren
cp .env.example .env
# .env-Datei mit den entsprechenden Werten bearbeiten

# Datenbank initialisieren
npm run db:migrate

# Server starten
npm start
```

## 📚 API-Dokumentation

Die API-Dokumentation ist über Swagger UI verfügbar:

- **Entwicklung**: [http://localhost:3000/api-docs/](http://localhost:3000/api-docs/)
- **Produktion**: [https://nbbv-sr-basar.de/api/api-docs/](https://nbbv-sr-basar.de/api/api-docs/)

### Verfügbare Endpunkte

#### Gesundheit

- `GET /api/health` - System-Gesundheitsstatus
- `GET /api/health/system` - Systeminformationen
- `GET /api/health/database` - Datenbank-Gesundheit

#### Spiele

- `GET /api/spiele` - Alle Spiele abrufen (mit Paginierung und Filtern)
- Filter und Sortierung werden serverseitig ausgeführt: Suche, Datumsbereiche (`dateFrom`/`dateTo`), Liga, Hallen-Mehrfachauswahl (`spielfeldNames`), Lizenzstufe sowie Heim-/Gastteam
- `atRiskOnly=true` filtert vor der Paginierung auf Spiele, bei denen `sr1OffenAngeboten` und `sr2OffenAngeboten` beide wahr sind. `isAtRisk` kennzeichnet diese Spiele; `availableFilters.atRiskCount` zählt sie im aktuellen Filterkontext (ohne `atRiskOnly`) und steuert die Verfügbarkeit des Filters.
- Mit `latitude`, `longitude`, `radiusKm` und `nearbyOnly=true` übernimmt die API auch Umkreisfilter und Entfernungssortierung (`sortBy=distance`); gespeicherte Hallenkoordinaten werden dabei wiederverwendet
- Jede Sortierung erhält als stabile Tie-Breaker Spieldatum/-zeit und Hallenname aufsteigend

#### Benutzer

- `POST /api/users/login` - Benutzer anmelden
- `POST /api/users/forgot-password` - Passwort vergessen
- `POST /api/users/reset-password` - Passwort zurücksetzen
- `GET /api/users/profile` - Benutzerprofil abrufen
- `PUT /api/users/profile` - Benutzerprofil aktualisieren

#### Vereine

- `GET /api/vereine` - Alle Vereine abrufen (mit Paginierung und Suchfunktion) 🔐
- `PATCH /api/vereine/:vereinId/hideLink` - hideLink für einen Verein aktualisieren (nur für Administratoren) 🔐

## 🔧 Entwicklung

### Verfügbare Scripts

```bash
npm start          # Server starten
npm run dev        # Entwicklungsserver mit Nodemon
npm test           # Tests ausführen
npm run db:migrate # Datenbank-Migrationen
npm run db:migrate:location # additive Hallenkoordinaten-Migration
npm run db:backfill:location # fehlende Hallenkoordinaten ergänzen, keine Spiele importieren/löschen
npm run db:seed    # Datenbank mit Testdaten füllen
```

### PM2 (Produktion)

```bash
npm run pm2:start   # PM2 starten
npm run pm2:stop    # PM2 stoppen
npm run pm2:restart # PM2 neu starten
npm run pm2:delete  # PM2 löschen
npm run pm2:logs    # PM2-Logs anzeigen
npm run pm2:monit   # PM2-Monitoring
```

## 🚢 Releases und Deployment

Pushes auf `main` führen die Jest-Tests aus. Ein Release wird über einen SemVer-
Tag ausgelöst, der exakt zur `version` in `package.json` passen muss:

```bash
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release backend v1.0.8"
git push origin main
git tag v1.0.8
git push origin v1.0.8
```

Der Deployment-Workflow verwendet auf dem ISPConfig-Server die Struktur
`/var/www/clients/client2/web3/private/{releases,shared,current}`. Die produktive
`.env` liegt ausschließlich unter `private/shared/.env`; `current` wird nach
erfolgreicher Installation atomar auf das neue Release gesetzt. PM2 lädt das
Release anschließend per Graceful Reload. Der Healthcheck muss erfolgreich sein,
sonst wird automatisch auf das vorherige Release zurückgeschaltet.

Vor dem Upload deaktiviert die Action ausdrücklich alte PM2-Datei-Wächter nur
für `srbasar-backend`, ohne die Prozesse zu stoppen. Ein bloßes `watch: false`
in der Konfiguration beseitigt bereits laufende Watcher nicht zuverlässig.
Nach dem erfolgreichen Reload wird die PM2-Konfiguration gespeichert.

Vor der Migration erstellt das Deployment ein komprimiertes Datenbank-Backup
unter `shared/backups` (nur für root lesbar). Beim Deployment werden die beiden nullable Spalten `spiel_latitude` und
`spiel_longitude` vor dem Aktivieren des neuen Releases additiv angelegt. Der
anschließende Backfill ergänzt ausschließlich fehlende Koordinaten vorhandener
Spiele, ohne Spiele zu löschen oder Besetzungsdaten zu verändern. Sind keine
Koordinaten ermittelbar, bleibt das bisherige Release aktiv.

Der
Synchronisationsjob geocodiert eine Hallenadresse nur, wenn noch keine passenden
Koordinaten in den Spielen vorhanden sind, verwendet vorhandene Koordinaten für
weitere Spiele wieder und liefert sie über `GET /v1/spiele` an das Frontend. Ein
Ausfall des Geocoding-Dienstes verhindert nicht den gesamten Spiel-Sync; das
betroffene Spiel bleibt dann ohne Koordinaten und wird bei einem späteren Lauf
erneut versucht.

Entfernungen sind Luftlinien in Kilometern. Die API berechnet und filtert diese
vor der Paginierung in der Datenbank. Spiele ohne Koordinaten erhalten `null`
und werden nicht als Treffer im Umkreis ausgegeben. Ungültige Standortparameter
liefern HTTP 400. Nutzerkoordinaten werden nicht in der Datenbank gespeichert.

Für das Repository werden die Actions-Secrets `DEPLOY_SSH_KEY` und
`DEPLOY_KNOWN_HOSTS` benötigt. Der private Schlüssel wird nicht im Repository
gespeichert.

## 🗄️ Datenbank

Das System verwendet SQLite als Datenbank mit Sequelize als ORM.

### Modelle

- **User** - Benutzerverwaltung
- **Spiel** - Basketball-Spiele
- **Verein** - Basketball-Vereine
- **SrQualifikation** - Schiedsrichter-Qualifikationen

## 📧 E-Mail-Service

Integrierter E-Mail-Service mit Handlebars-Templates für:

- Passwort-Reset
- Benachrichtigungen

## 🔄 Cron-Jobs

Automatisierte Aufgaben für:

- **W1 Cron-Job**: Läuft alle 5 Minuten zur Synchronisation der W1-Liga-Daten
- **W3 Cron-Job**: Läuft alle 15 Minuten zur Synchronisation der W3-Liga-Daten  
- **All Cron-Job**: Läuft alle 30 Minuten zur Synchronisation aller Liga-Daten
- Datenbank-Wartung
- System-Updates

## 🛡️ Sicherheit

- JWT-basierte Authentifizierung
- Helmet.js für Sicherheits-Header
- CORS-Konfiguration
- Eingabevalidierung

## 📝 Umgebungsvariablen

Erstelle eine `.env`-Datei mit folgenden Variablen:

```env
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-password
```

## 🤝 Beitragen

1. Fork das Repository
2. Erstelle einen Feature-Branch (`git checkout -b feature/amazing-feature`)
3. Committe deine Änderungen (`git commit -m 'Add amazing feature'`)
4. Push zum Branch (`git push origin feature/amazing-feature`)
5. Öffne einen Pull Request

## 📄 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert.
