const { QueryTypes, Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { loadConfig } = require('../modules/ballersclub/config');
const ballersCatalog = require('../modules/ballersclub/catalogRepository');
const { getDistanceExpression, getDistanceNullsLastExpression } = require('../utils/spielQuery');

const FIELDS = ['spielplanId', 'spieldatum', 'heimMannschaftName', 'gastMannschaftName', 'ligaName', 'bezirkName', 'spielfeldName', 'spielStrasse', 'spielPlz', 'spielOrt', 'srLizenz', 'sr1OffenAngeboten', 'sr2OffenAngeboten', 'sr3OffenAngeboten', 'sr1VereinName', 'sr2VereinName', 'sr3VereinName'];
const FILTER_FIELDS = ['spielfeldName', 'ligaName', 'bezirkName', 'srLizenz', 'spieldatum', 'sr1OffenAngeboten', 'sr2OffenAngeboten'];
const SORTABLE = new Set([...FIELDS, 'distance']);

function buildOrder(sortBy, sortOrder, coordinates) {
  const field = SORTABLE.has(sortBy) ? sortBy : 'spieldatum';
  const direction = sortOrder === 'DESC' ? 'DESC' : 'ASC';
  if (field === 'spieldatum') return `DATE(FROM_UNIXTIME(spieldatum / 1000)) ${direction}, spielfeldName ASC, spieldatum ${direction}, entryId ASC`;
  const primary = field === 'distance' && coordinates
    ? `${getDistanceNullsLastExpression()} ASC, ${getDistanceExpression(coordinates)} ${direction}`
    : `\`${field === 'distance' ? 'spieldatum' : field}\` ${direction}`;
  return `${primary}, spieldatum ASC, spielfeldName ASC, entryId ASC`;
}

class BasarRepository {
  constructor({ source = 'all', config = loadConfig(), now = new Date() } = {}) {
    this.config = config;
    this.source = source;
    this.now = now;
  }

  projection() {
    const { Spiel } = require('../models');
    const teamFields = FIELDS.map(field => `s.\`${Spiel.rawAttributes[field].field}\` AS \`${field}\``).join(', ');
    const team = `SELECT CONCAT('team-sl:', s.spielplan_id) AS entryId, 'team-sl' AS source, ${teamFields}, s.spiel_latitude, s.spiel_longitude FROM spiele s`;
    const ballers = ballersCatalog.projection(FIELDS);
    return this.source === 'ballers-club' ? ballers : `${team} UNION ALL ${ballers}`;
  }

  replacements() {
    return ballersCatalog.queryBounds(this.config, this.now);
  }

  async select(columns, where = {}, suffix = '', transaction) {
    const whereSql = sequelize.getQueryInterface().queryGenerator.whereQuery(where);
    return sequelize.query(`SELECT ${columns} FROM (${this.projection()}) AS basar ${whereSql} ${suffix}`, { replacements: this.replacements(), type: QueryTypes.SELECT, transaction });
  }

  async filters() { return this.select(FILTER_FIELDS.map(field => `\`${field}\``).join(', ')); }

  async count(where) {
    const [row] = await this.select('COUNT(*) AS total', where);
    return Number(row.total);
  }

  async findAndCountAll({ where, include, limit, offset, sortBy, sortOrder, coordinates }) {
    const { Spiel } = require('../models');
    return sequelize.transaction(async transaction => {
      const [countRow] = await this.select('COUNT(*) AS total', where, '', transaction);
      const distance = coordinates ? `, ${getDistanceExpression(coordinates)} AS distanceKm` : '';
      const keys = await this.select(`entryId, source, spielplanId${distance}`, where, `ORDER BY ${buildOrder(sortBy, sortOrder, coordinates)} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, transaction);
      const teamIds = keys.filter(row => row.source === 'team-sl').map(row => row.spielplanId);
      const ballersIds = keys.filter(row => row.source === 'ballers-club').map(row => row.entryId.slice('ballers-club:'.length));
      const [games, tournaments] = await Promise.all([
        teamIds.length ? Spiel.findAll({ where: { spielplanId: { [Op.in]: teamIds } }, include, transaction }) : [],
        ballersCatalog.findEntries(ballersIds, transaction)
      ]);
      const entries = new Map(games.map(game => [`team-sl:${game.spielplanId}`, { ...game.toJSON(), source: 'team-sl', id: `team-sl:${game.spielplanId}` }]));
      for (const game of tournaments) entries.set(game.id, game);
      const rows = keys.map(key => ({ toJSON: () => ({ ...entries.get(key.entryId), ...(coordinates ? { distanceKm: key.distanceKm } : {}) }) }));
      return { count: Number(countRow.total), rows };
    });
  }
}

module.exports = { BasarRepository, buildOrder };
