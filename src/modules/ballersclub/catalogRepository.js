const { Op } = require('sequelize');
const { dateWindow, berlinTimestamp } = require('./parser');

function projection(fields) {
  const values = {
    spielplanId: 'NULL', spieldatum: 't.starts_at', heimMannschaftName: "''", gastMannschaftName: "''",
    ligaName: 't.tournament_type', spielfeldName: 'COALESCE(h.name, t.location_raw)',
    spielStrasse: "COALESCE(h.street, '')", spielPlz: "COALESCE(h.postal_code, '')", spielOrt: "COALESCE(h.city, '')",
    srLizenz: 'NULL', sr1OffenAngeboten: '0', sr2OffenAngeboten: '0', sr3OffenAngeboten: '0',
    sr1VereinName: 'NULL', sr2VereinName: 'NULL', sr3VereinName: 'NULL'
  };
  const columns = fields.map(field => {
    if (!Object.hasOwn(values, field)) throw new Error(`Unsupported catalog field: ${field}`);
    return `${values[field]} AS \`${field}\``;
  }).join(', ');
  return `SELECT CONCAT('ballers-club:', t.id) AS entryId, 'ballers-club' AS source, ${columns}, h.latitude AS spiel_latitude, h.longitude AS spiel_longitude
    FROM ballersclub_turniere t LEFT JOIN hallen h ON h.id = t.hall_id
    WHERE t.source_key = :sourceKey AND t.free_spots > 0 AND t.ends_at >= :now AND t.starts_at BETWEEN :firstDay AND :lastDay`;
}

function queryBounds(config, now) {
  const { today, lastDay } = dateWindow(now, config.daysAhead);
  return { sourceKey: config.sourceKey, now: now.getTime(), firstDay: berlinTimestamp(today), lastDay: berlinTimestamp(lastDay, '23:59') + 59999 };
}

function toBallersGame(event) {
  const hall = event.hall;
  return {
    id: `ballers-club:${event.id}`, source: 'ballers-club', spielplanId: null, tournamentId: event.id,
    spieldatum: Number(event.startsAt), endTimestamp: Number(event.endsAt), ligaName: event.tournamentType,
    tournamentType: event.tournamentType, timeLabel: event.timeLabel, meetingTime: event.meetingTime,
    spielfeldName: hall?.name || event.locationRaw, sourceHallName: event.locationRaw, hallId: hall?.id || null,
    spielStrasse: hall?.street || '', spielPlz: hall?.postalCode || '', spielOrt: hall?.city || '',
    spielLatitude: hall?.latitude ?? null, spielLongitude: hall?.longitude ?? null,
    totalSpots: event.totalSpots, freeSpots: event.freeSpots, srLizenz: null,
    heimMannschaftName: '', gastMannschaftName: '', isAtRisk: false
  };
}

async function findEntries(ids, transaction) {
  if (!ids.length) return [];
  const { BallersTournament, Hall } = require('../../models');
  const rows = await BallersTournament.findAll({ where: { id: { [Op.in]: ids } }, include: [{ model: Hall, as: 'hall' }], transaction });
  return rows.map(event => toBallersGame(event.toJSON()));
}

module.exports = { projection, queryBounds, findEntries, toBallersGame };
