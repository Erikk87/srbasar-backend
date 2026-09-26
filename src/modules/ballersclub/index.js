const { Router } = require('express');
const controller = require('./controller');
const { ballersClubService } = require('./service');
const router = Router();
router.get('/spiele', controller.getSpiele);
router.get('/status', controller.getStatus);

module.exports = { router, start: () => ballersClubService.start(), stop: () => ballersClubService.stop() };
/**
 * @swagger
 * /v1/ballersclub/spiele:
 *   get:
 *     summary: Offene Ballers-Club-Turniere
 *     description: Gleiche Filter, Sortierung und Pagination wie /v1/spiele; Quelle ist fest ballers-club. Nur aktuelle Turniere mit freien gelben Schiedsrichter-Plätzen im konfigurierten Zeitfenster.
 *     tags: [Ballers Club]
 *     responses:
 *       200:
 *         description: Turniere, Pagination, verfügbare Filter und Quellenstatus; bei veraltetem Import eine leere Turnierliste
 * /v1/ballersclub/status:
 *   get:
 *     summary: Verfügbarkeit und Kontaktkonfiguration des Moduls
 *     tags: [Ballers Club]
 *     responses:
 *       200:
 *         description: enabled, available, status, updatedAt und öffentliche Kontaktdaten; keine Tabellen-URL oder Bewerberdaten
 */
