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
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [spieldatum, ligaName, spielfeldName, heimMannschaftName, gastMannschaftName, sr1VereinName, sr2VereinName]
 *           default: spieldatum
 *         description: Feld für die Sortierung
 *       - in: query
 *         name: atRiskOnly
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Nur Spiele, bei denen beide SR-Positionen offen angeboten werden; serverseitig vor Paginierung
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
 *                           description: Anzahl ausfallbedrohter Spiele im gesamten Basar, unabhängig von aktueller Seite und Filtern
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
