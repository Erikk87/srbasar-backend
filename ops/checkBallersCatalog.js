const assert = require('node:assert/strict');
const { sequelize } = require('../src/config/database');
const { loadConfig } = require('../src/modules/ballersclub/config');
const spieleController = require('../src/controllers/spieleController');

async function checkCatalog() {
  if (!loadConfig().enabled) return;
  for (const query of [
    { source: 'all', limit: 5 },
    { source: 'ballers-club', limit: 100 },
    { source: 'all', limit: 3, latitude: 52.52, longitude: 13.405, radiusKm: 20, sortBy: 'distance' }
  ]) {
    let payload;
    let status = 200;
    await spieleController.getAllSpiele({ query }, { status(code) { status = code; return this; }, json(value) { payload = value; } });
    assert.equal(status, 200, 'API-Abfrage fehlgeschlagen');
    assert.equal(payload?.success, true);
    assert.equal(payload.data.sources.ballersClub.available, true);
    assert.ok(payload.data.spiele.length <= query.limit);
    assert.equal(new Set(payload.data.spiele.map(game => game.id)).size, payload.data.spiele.length);
    if (query.source === 'ballers-club') assert.ok(payload.data.spiele.every(game => game.source === 'ballers-club' && game.freeSpots > 0 && game.spielplanId === null));
  }
  console.log('Ballers Club: gemischte API, Modul-API und Entfernungssortierung geprüft.');
}

if (require.main === module) checkCatalog().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => sequelize.close());

module.exports = { checkCatalog };
