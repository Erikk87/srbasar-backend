const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

module.exports = sequelize.define('Hall', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  identityKey: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  teamSlId: { type: DataTypes.STRING(80), allowNull: true },
  name: { type: DataTypes.STRING, allowNull: false },
  street: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  postalCode: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
  city: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  latitude: { type: DataTypes.DOUBLE, allowNull: true },
  longitude: { type: DataTypes.DOUBLE, allowNull: true },
  lastSeenAt: { type: DataTypes.DATE, allowNull: false }
}, { tableName: 'hallen', indexes: [{ fields: ['team_sl_id'] }] });
