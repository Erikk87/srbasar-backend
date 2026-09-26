const { createHash } = require('node:crypto');
const { Op } = require('sequelize');
const { getCoordinates } = require('../utils/coordinates');

const normalize = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const identityKey = venue => createHash('sha256').update([venue.name, venue.street, venue.postalCode, venue.city].map(normalize).join('|')).digest('hex');

async function rememberVenue(venue, transaction) {
  const { Hall } = require('../models');
  if (!venue.name || !venue.street || !venue.city) return null;
  const key = identityKey(venue);
  const coordinates = getCoordinates(venue.latitude, venue.longitude);
  const values = { name: venue.name, street: venue.street || '', postalCode: venue.postalCode || '', city: venue.city || '', lastSeenAt: new Date() };
  if (venue.teamSlId !== null && venue.teamSlId !== undefined) values.teamSlId = String(venue.teamSlId).slice(0, 80);
  if (coordinates) Object.assign(values, coordinates);
  const [hall, created] = await Hall.findOrCreate({ where: { identityKey: key }, defaults: values, transaction });
  if (!created) await hall.update(values, { transaction });
  return hall;
}

async function seedFromGames() {
  const { Spiel, Hall } = require('../models');
  if (!Hall) return;
  const rows = await Spiel.findAll({ attributes: ['spielplanId', 'spielfeldName', 'spielStrasse', 'spielPlz', 'spielOrt', 'spielLatitude', 'spielLongitude', 'hallId'], raw: true });
  for (const row of rows) {
    const hall = await rememberVenue({ name: row.spielfeldName, street: row.spielStrasse, postalCode: row.spielPlz, city: row.spielOrt, latitude: row.spielLatitude, longitude: row.spielLongitude });
    if (hall && row.hallId !== hall.id) await Spiel.update({ hallId: hall.id }, { where: { spielplanId: row.spielplanId } });
  }
}

async function coordinatesForAddresses(addresses) {
  const { Hall } = require('../models');
  if (!Hall || !addresses.length) return [];
  return Hall.findAll({ where: { [Op.or]: addresses.map(address => ({ street: address.street, postalCode: address.postalCode, city: address.city })) }, raw: true });
}

module.exports = { normalize, identityKey, rememberVenue, seedFromGames, coordinatesForAddresses };
