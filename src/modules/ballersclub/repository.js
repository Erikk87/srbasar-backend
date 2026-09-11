const { sequelize } = require('../../config/database');
const { resolveHalls } = require('./hallRepository');

async function getSync(sourceKey) {
  const { BallersSync } = require('../../models');
  return BallersSync.findByPk(sourceKey, { raw: true });
}

async function replaceSnapshot(events, sourceKey, fetchedAt) {
  const { BallersSync, BallersTournament } = require('../../models');
  return sequelize.transaction(async transaction => {
    const resolved = await resolveHalls(events, sourceKey, transaction);
    await BallersTournament.destroy({ where: { sourceKey }, transaction });
    if (resolved.length) await BallersTournament.bulkCreate(resolved, { transaction, validate: true });
    await BallersSync.upsert({ sourceKey, fetchedAt, lastAttemptAt: fetchedAt, lastError: null }, { transaction });
  });
}

async function recordFailure(sourceKey, code) {
  const { BallersSync } = require('../../models');
  const [sync] = await BallersSync.findOrCreate({ where: { sourceKey }, defaults: { lastAttemptAt: new Date() } });
  await sync.update({ lastAttemptAt: new Date(), lastError: code });
}

module.exports = { getSync, replaceSnapshot, recordFailure };
