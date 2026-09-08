const { DataTypes } = require("sequelize");
const { sequelize } = require("../src/config/database");
require("../src/models");

const LOCATION_COLUMNS = [
  {
    name: "spiel_latitude",
    definition: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: "Geografische Breite des Spielorts",
    },
  },
  {
    name: "spiel_longitude",
    definition: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: "Geografische Länge des Spielorts",
    },
  },
];

async function ensureLocationColumns() {
  const queryInterface = sequelize.getQueryInterface();
  await sequelize.sync({ alter: false, force: false });
  let tableDescription = await queryInterface.describeTable("spiele");

  for (const column of LOCATION_COLUMNS) {
    if (tableDescription[column.name]) continue;

    console.log(`Füge ${column.name} zu spiele hinzu...`);
    await queryInterface.addColumn("spiele", column.name, column.definition);
    tableDescription = await queryInterface.describeTable("spiele");
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    await ensureLocationColumns();
    console.log("Datenbankmigration erfolgreich abgeschlossen.");
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Datenbankmigration fehlgeschlagen:", error);
    process.exitCode = 1;
  });
}

module.exports = { ensureLocationColumns };
