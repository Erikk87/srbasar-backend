const { sequelize } = require('../src/config/database');
const { loadConfig } = require('../src/modules/ballersclub/config');
const { confirmMapping } = require('../src/modules/ballersclub/hallRepository');

async function main() {
  try {
    const [rawName, target] = process.argv.slice(2);
    const config = loadConfig();
    if (!config.enabled || !rawName || !/^(?:[1-9]\d*|none)$/.test(target || '')) throw new Error('Aufruf: node ops/mapBallersHall.js "Sheet-Hallenname" HALLEN_ID|none');
    const result = await confirmMapping(config.sourceKey, rawName, target === 'none' ? null : Number(target));
    console.log(JSON.stringify(result));
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { main };
