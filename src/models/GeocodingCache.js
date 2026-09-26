const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

module.exports = sequelize.define('GeocodingCache', {
  key: { type: DataTypes.STRING(64), primaryKey: true },
  latitude: { type: DataTypes.DOUBLE, allowNull: true },
  longitude: { type: DataTypes.DOUBLE, allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false },
  retryAfter: { type: DataTypes.DATE, allowNull: true }
}, { tableName: 'geocoding_cache' });
