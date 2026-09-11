const { createHash } = require('node:crypto');
const { Op } = require('sequelize');
const hash = key => createHash('sha256').update(key).digest('hex');

async function lookup(key) {
  const { GeocodingCache } = require('../models');
  const row = await GeocodingCache.findByPk(hash(key), { raw: true });
  if (!row) return { hit: false };
  if (row.status === 'success') return { hit: true, coordinates: { latitude: row.latitude, longitude: row.longitude } };
  return { hit: new Date(row.retryAfter).getTime() > Date.now(), coordinates: null };
}

async function claim(key) {
  const { GeocodingCache } = require('../models');
  const now = new Date();
  const lease = { status: 'pending', retryAfter: new Date(now.getTime() + 60000) };
  const [, created] = await GeocodingCache.findOrCreate({ where: { key: hash(key) }, defaults: lease });
  if (created) return true;
  const [updated] = await GeocodingCache.update(lease, { where: { key: hash(key), status: { [Op.ne]: 'success' }, retryAfter: { [Op.lte]: now } } });
  return updated === 1;
}

async function save(key, coordinates, failed = false) {
  const { GeocodingCache } = require('../models');
  await GeocodingCache.upsert({ key: hash(key), latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null,
    status: coordinates ? 'success' : failed ? 'error' : 'not-found', retryAfter: coordinates ? null : new Date(Date.now() + (failed ? 15 * 60000 : 86400000)) });
}

module.exports = { lookup, claim, save };
