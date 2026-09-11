const { sequelize } = require('../src/config/database');
require('../src/models');
const { ballersClubService } = require('../src/modules/ballersclub/service');
const { loadConfig } = require('../src/modules/ballersclub/config');

async function main() {
  try {
    if (!loadConfig().enabled) return;
    await sequelize.authenticate();
    await ballersClubService.refresh();
    const state = await ballersClubService.publicState();
    if (!state.available) throw new Error('Kein aktueller Ballers-Club-Import verfügbar.');
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { main };
