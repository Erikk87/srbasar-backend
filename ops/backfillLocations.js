const { Op } = require("sequelize");
const { sequelize } = require("../src/config/database");
const { Spiel } = require("../src/models");
const { GeocodingService, getAddressKey } = require("../src/services/geocodingService");
const { getCoordinates } = require("../src/utils/coordinates");

async function backfillLocations({ model = Spiel, geocoder = new GeocodingService() } = {}) {
  const rows = await model.findAll({
    attributes: ["spielplanId", "spielStrasse", "spielPlz", "spielOrt", "spielLatitude", "spielLongitude"],
    raw: true
  });
  const groups = new Map();
  let incomplete = 0;
  for (const row of rows) {
    const address = { street: row.spielStrasse, postalCode: row.spielPlz, city: row.spielOrt };
    if (!address.street || !address.postalCode || !address.city) {
      incomplete += 1;
      continue;
    }
    const key = getAddressKey(address);
    if (!groups.has(key)) groups.set(key, { address, rows: [], coordinates: null });
    const group = groups.get(key);
    group.rows.push(row);
    group.coordinates ||= getCoordinates(row.spielLatitude, row.spielLongitude);
  }

  let updated = 0;
  let unresolved = 0;
  for (const group of groups.values()) {
    const missing = group.rows.filter((row) => !getCoordinates(row.spielLatitude, row.spielLongitude));
    if (!missing.length) continue;
    try {
      group.coordinates ||= await geocoder.geocodeAddress(group.address);
    } catch {
      group.coordinates = null;
    }
    const coordinates = getCoordinates(group.coordinates?.latitude, group.coordinates?.longitude);
    if (!coordinates) {
      unresolved += missing.length;
      continue;
    }
    // Nur Koordinaten ergänzen; keine Spiel- oder Besetzungsdaten synchronisieren.
    // Der Adressvergleich schützt vor parallel geänderten Spielorten.
    for (const row of missing) {
      const [count] = await model.update({
        spielLatitude: coordinates.latitude,
        spielLongitude: coordinates.longitude
      }, {
        where: {
          spielplanId: row.spielplanId,
          spielStrasse: row.spielStrasse,
          spielPlz: row.spielPlz,
          spielOrt: row.spielOrt,
          [Op.or]: [{ spielLatitude: null }, { spielLongitude: null }]
        },
        silent: true
      });
      updated += count;
    }
  }
  const summary = { games: rows.length, addresses: groups.size, updated, unresolved, incomplete };
  console.log("Hallenkoordinaten:", JSON.stringify(summary));
  if (rows.length && unresolved + incomplete === rows.length) {
    throw new Error("Keine Hallenkoordinaten verfügbar; Release wird nicht aktiviert.");
  }
  return summary;
}

if (require.main === module) {
  sequelize.authenticate()
    .then(() => backfillLocations())
    .catch(() => {
      console.error("Vorberechnung der Hallenkoordinaten fehlgeschlagen.");
      process.exitCode = 1;
    })
    .finally(() => sequelize.close());
}

module.exports = { backfillLocations };
