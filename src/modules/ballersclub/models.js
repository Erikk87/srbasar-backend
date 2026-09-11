const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const BallersTournament = sequelize.define('BallersTournament', {
  id: { type: DataTypes.STRING(64), primaryKey: true },
  sourceKey: { type: DataTypes.STRING(64), allowNull: false },
  sheetRow: { type: DataTypes.INTEGER, allowNull: false },
  tournamentType: { type: DataTypes.STRING, allowNull: false },
  date: { type: DataTypes.STRING(10), allowNull: false },
  startsAt: { type: DataTypes.BIGINT, allowNull: false },
  endsAt: { type: DataTypes.BIGINT, allowNull: false },
  timeLabel: { type: DataTypes.STRING, allowNull: false },
  meetingTime: { type: DataTypes.STRING, allowNull: true },
  locationRaw: { type: DataTypes.STRING, allowNull: false },
  hallId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  totalSpots: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  freeSpots: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }
}, { tableName: 'ballersclub_turniere', indexes: [{ fields: ['source_key', 'starts_at'] }] });

const BallersSync = sequelize.define('BallersSync', {
  sourceKey: { type: DataTypes.STRING(64), primaryKey: true },
  fetchedAt: { type: DataTypes.DATE, allowNull: true },
  lastAttemptAt: { type: DataTypes.DATE, allowNull: false },
  lastError: { type: DataTypes.STRING(80), allowNull: true }
}, { tableName: 'ballersclub_sync' });

const BallersHallMapping = sequelize.define('BallersHallMapping', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  sourceKey: { type: DataTypes.STRING(64), allowNull: false },
  normalizedName: { type: DataTypes.STRING(255), allowNull: false },
  sourceName: { type: DataTypes.STRING, allowNull: false },
  hallId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  manual: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  lastSeenAt: { type: DataTypes.DATE, allowNull: false }
}, { tableName: 'ballersclub_hallen_mapping', indexes: [{ unique: true, fields: ['source_key', 'normalized_name'] }] });

module.exports = { BallersTournament, BallersSync, BallersHallMapping };
