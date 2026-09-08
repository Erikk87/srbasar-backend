# Srbasar Backend

Express.js Backend mit Sequelize und SQLite für das Srbasar-System zur Verwaltung von Basketball-Spielen und Schiedsrichtern.

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
- **Produktion**: [https://api.srbasar.de/api-docs/](https://api.srbasar.de/api-docs/)

### Verfügbare Endpunkte

#### Gesundheit

- `GET /api/health` - System-Gesundheitsstatus
- `GET /api/health/system` - Systeminformationen
- `GET /api/health/database` - Datenbank-Gesundheit

#### Spiele

- `GET /api/spiele` - Alle Spiele abrufen (mit Paginierung und Filtern)
- Unterstützt Filterung nach Datum, Liga, Spielfeld und globale Suche

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
git commit -m "Release backend v1.0.7"
git push origin main
git tag v1.0.7
git push origin v1.0.7
```

Der Deployment-Workflow verwendet auf dem ISPConfig-Server die Struktur
`/var/www/clients/client2/web3/private/{releases,shared,current}`. Die produktive
`.env` liegt ausschließlich unter `private/shared/.env`; `current` wird nach
erfolgreicher Installation atomar auf das neue Release gesetzt. PM2 lädt das
Release anschließend per Graceful Reload. Der Healthcheck muss erfolgreich sein,
sonst wird automatisch auf das vorherige Release zurückgeschaltet.

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
