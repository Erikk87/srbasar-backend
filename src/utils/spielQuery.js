const { getCoordinates, parseCoordinate } = require("./coordinates");
const DEFAULT_SORT_FIELD = "spieldatum";
const DEFAULT_SORT_ORDER = "ASC";

const SORT_FIELDS = Object.freeze({
  spieldatum: "spieldatum",
  date: "spieldatum",
  ligaName: "ligaName",
  league: "ligaName",
  bezirkName: "bezirkName",
  district: "bezirkName",
  spielfeldName: "spielfeldName",
  venue: "spielfeldName",
  heimMannschaftName: "heimMannschaftName",
  homeTeam: "heimMannschaftName",
  gastMannschaftName: "gastMannschaftName",
  awayTeam: "gastMannschaftName",
  srLizenz: "srLizenz",
  license: "srLizenz",
  sr1VereinName: "sr1VereinName",
  sr2VereinName: "sr2VereinName",
  distance: "distance"
});

function parseList(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");

  return [...new Set(
    values
      .flatMap((entry) => String(entry).split(","))
      .map((entry) => entry.trim())
      .filter(Boolean)
  )];
}

function parseDatePart(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return value;
}

function getLocalDayBoundary(datePart, endOfDay = false) {
  const [year, month, day] = datePart.split("-").map(Number);
  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const millisecond = endOfDay ? 999 : 0;
  const nominalUtcTimestamp = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond
  );
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(nominalUtcTimestamp));
  const values = Object.fromEntries(localParts.map((part) => [part.type, part.value]));
  const berlinAsUtcTimestamp = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
    millisecond
  );

  return nominalUtcTimestamp - (berlinAsUtcTimestamp - nominalUtcTimestamp);
}

function getDateRange(query = {}) {
  const hasDateQuery = query.date || query.dateFrom || query.dateTo;
  if (!hasDateQuery) return null;

  const hasRequestedFrom = query.dateFrom !== undefined || query.date !== undefined;
  const hasRequestedTo = query.dateTo !== undefined || query.date !== undefined;
  const requestedFrom = query.dateFrom || query.date;
  const requestedTo = query.dateTo || query.date;
  const from = hasRequestedFrom ? parseDatePart(String(requestedFrom)) : null;
  const to = hasRequestedTo ? parseDatePart(String(requestedTo)) : null;

  if (
    (hasRequestedFrom && !from)
    || (hasRequestedTo && !to)
    || (from && to && from > to)
  ) {
    return { invalid: true };
  }

  return {
    start: from ? getLocalDayBoundary(from) : null,
    end: to ? getLocalDayBoundary(to, true) : null
  };
}

function getPagination(page, limit) {
  const parsedPage = Number.parseInt(page, 10);
  const parsedLimit = Number.parseInt(limit, 10);
  const pageNumber = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const pageSize = Math.min(
    100,
    Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20
  );

  return {
    pageNumber,
    pageSize,
    offset: (pageNumber - 1) * pageSize
  };
}

function getSortParameters(sortBy, sortOrder) {
  const requestedSort = String(sortBy || DEFAULT_SORT_FIELD).trim();
  const requestedOrder = String(sortOrder || DEFAULT_SORT_ORDER).toUpperCase();

  return {
    sortBy: SORT_FIELDS[requestedSort] || DEFAULT_SORT_FIELD,
    sortOrder: requestedOrder === "DESC" ? "DESC" : DEFAULT_SORT_ORDER
  };
}

function getRadiusKm(value) {
  const radiusKm = parseCoordinate(value);
  if (radiusKm === null || radiusKm <= 0 || radiusKm > 500) return null;
  return radiusKm;
}

function getDistanceExpression({ latitude, longitude }) {
  const safeLatitude = Number(latitude).toFixed(8);
  const safeLongitude = Number(longitude).toFixed(8);

  return [
    "CASE WHEN spiel_latitude IS NULL OR spiel_longitude IS NULL THEN NULL ELSE ",
    "6371 * 2 * ASIN(SQRT(LEAST(1, GREATEST(0, ",
    `POW(SIN(RADIANS(${safeLatitude} - spiel_latitude) / 2), 2) + `,
    `COS(RADIANS(${safeLatitude})) * COS(RADIANS(spiel_latitude)) * `,
    `POW(SIN(RADIANS(${safeLongitude} - spiel_longitude) / 2), 2)`,
    ")))) END"
  ].join("");
}

function getDistanceNullsLastExpression() {
  return "CASE WHEN spiel_latitude IS NULL OR spiel_longitude IS NULL THEN 1 ELSE 0 END";
}

module.exports = {
  DEFAULT_SORT_FIELD,
  DEFAULT_SORT_ORDER,
  getCoordinates,
  getDateRange,
  getDistanceExpression,
  getDistanceNullsLastExpression,
  getPagination,
  getRadiusKm,
  getSortParameters,
  parseDatePart,
  parseList
};
