const { normalizeHallName, findHall } = require('./hallResolver');
const { Op } = require('sequelize');
const { sequelize } = require('../../config/database');

async function resolveHalls(events, sourceKey, transaction) {
  const { Hall, BallersHallMapping } = require('../../models');
  const halls = await Hall.findAll({ raw: true, transaction });
  const resolved = new Map();
  const results = [];
  for (const event of events) {
    const normalizedName = normalizeHallName(event.locationRaw);
    if (!resolved.has(normalizedName)) {
      const [mapping] = await BallersHallMapping.findOrCreate({
        where: { sourceKey, normalizedName },
        defaults: { sourceName: event.locationRaw, lastSeenAt: new Date() },
        transaction
      });
      const hall = mapping.manual ? halls.find(entry => entry.id === mapping.hallId) : findHall(event.locationRaw, halls);
      // Manual NULL explicitly prevents automatic assignment as well.
      await mapping.update({ lastSeenAt: new Date(), ...(mapping.manual ? {} : { hallId: hall?.id ?? null }) }, { transaction });
      resolved.set(normalizedName, hall?.id ?? null);
    }
    results.push({ ...event, hallId: resolved.get(normalizedName) });
  }
  return results;
}

async function confirmMapping(sourceKey, rawName, hallId) {
  if (typeof rawName !== 'string' || !rawName.trim() || rawName.length > 255 || /[\r\n\0]/.test(rawName)) throw new Error('Ungültiger Hallenname');
  if (hallId !== null && (!Number.isSafeInteger(hallId) || hallId <= 0)) throw new Error('Ungültige Hallen-ID');
  const { Hall, BallersHallMapping, BallersTournament } = require('../../models');
  return sequelize.transaction(async transaction => {
    const hall = hallId === null ? null : await Hall.findByPk(hallId, { transaction });
    if (hallId !== null && !hall) throw new Error('Hallen-ID nicht vorhanden');
    const normalizedName = normalizeHallName(rawName);
    const [mapping] = await BallersHallMapping.findOrCreate({ where: { sourceKey, normalizedName }, defaults: { sourceName: rawName, lastSeenAt: new Date() }, transaction });
    await mapping.update({ hallId, manual: true, lastSeenAt: new Date() }, { transaction });
    const events = await BallersTournament.findAll({ where: { sourceKey }, attributes: ['id', 'locationRaw'], raw: true, transaction });
    const ids = events.filter(event => normalizeHallName(event.locationRaw) === normalizedName).map(event => event.id);
    if (ids.length) await BallersTournament.update({ hallId }, { where: { id: { [Op.in]: ids } }, transaction });
    return { mappingId: mapping.id, sourceName: rawName, hallId, hallName: hall?.name || null, updatedEvents: ids.length };
  });
}

module.exports = { resolveHalls, confirmMapping };
