const express = require('express');
const spieleController = require('../controllers/spieleController');

const router = express.Router();

/**
 * @swagger
 * /v1/spiele:
 *   get:
 *     summary: Alle Spiele abrufen
 *     description: Ruft alle Spiele mit Paginierung und Filtern ab, inklusive verfügbare Filter-Werte
 *     tags: [Spiele]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Seitennummer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Anzahl der Einträge pro Seite (max. 100)
 *       - in: query
 *         name: spieldatum
 *         schema:
 *           type: integer
 *         description: Spieldatum als Unix-Timestamp (filtert nach dem ganzen Tag)
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Ein bestimmter Spieltag im Format YYYY-MM-DD
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Beginn des Datumsbereichs im Format YYYY-MM-DD
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: Ende des Datumsbereichs im Format YYYY-MM-DD
 *       - in: query
 *         name: ligaName
 *         schema:
 *           type: string
 *         description: Liga-Name (Teilstring-Suche)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Globale Suche über alle Textfelder (Mannschaften, Liga, Spielfeld, Adresse)
 *       - in: query
 *         name: spielfeldName
 *         schema:
 *           type: string
 *         description: Spielfeld-Name (Teilstring-Suche)
 *       - in: query
 *         name: spielfeldNames
 *         schema:
 *           type: string
 *         description: Mehrere exakte Spielfeld-Namen, kommasepariert
 *       - in: query
 *         name: srLizenz
 *         schema:
 *           type: string
 *         description: Benötigte SR-Lizenz (Teilstring-Suche)
 *       - in: query
 *         name: srLizenzen
 *         schema:
 *           type: string
 *         description: Mehrere exakte SR-Lizenzen, kommasepariert
 *       - in: query
 *         name: latitude
 *         schema:
 *           type: number
 *           format: double
 *         description: Breitengrad des Nutzerstandorts für Entfernungssortierung und Umkreisfilter
 *       - in: query
 *         name: longitude
 *         schema:
 *           type: number
 *           format: double
 *         description: Längengrad des Nutzerstandorts für Entfernungssortierung und Umkreisfilter
 *       - in: query
 *         name: radiusKm
 *         schema:
 *           type: number
 *           format: double
 *         description: Maximaler Umkreis in Kilometern
 *       - in: query
 *         name: nearbyOnly
 *         schema:
 *           type: boolean
 *         description: Beschränkt die Ergebnisse auf den angegebenen Umkreis
 *       - in: query
 *         name: atRiskOnly
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Nur ausfallbedrohte Spiele, bei denen SR1 und SR2 offen angeboten werden; vor Paginierung angewendet
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [spieldatum, ligaName, spielfeldName, heimMannschaftName, gastMannschaftName, srLizenz, distance, sr1VereinName, sr2VereinName]
 *           default: spieldatum
 *         description: Feld für die Sortierung
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *           default: ASC
 *         description: Sortierreihenfolge
 *     responses:
 *       200:
 *         description: Spiele erfolgreich abgerufen
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     spiele:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Spiel'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *                     availableFilters:
 *                       type: object
 *                       properties:
 *                         atRiskCount:
 *                           type: integer
 *                           minimum: 0
 *                           description: Anzahl ausfallbedrohter Spiele im aktuellen Filterkontext, ohne den atRiskOnly-Filter selbst
 *                         spielfeldName:
 *                           type: array
 *                           items:
 *                             type: string
 *                           description: Verfügbare Spielfeld-Namen
 *                         ligaName:
 *                           type: array
 *                           items:
 *                             type: string
 *                           description: Verfügbare Liga-Namen
 *                         spieldatum:
 *                           type: array
 *                           items:
 *                             type: integer
 *                           description: Verfügbare Spieldaten (Unix-Timestamp)
 *       400:
 *         description: Ungültiger Filterwert
 *       500:
 *         description: Serverfehler
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', spieleController.getAllSpiele);

module.exports = router; 
