const { normalize } = require('../../repositories/hallRepository');

function normalizeHallName(value) {
  return normalize(value).replace(/\s*\((?:anschluss|bei bedarf anfragbar)\)\s*/g, ' ').replace(/[<>]+/g, '').replace(/\s+/g, ' ').trim();
}

function candidateName(value) {
  return normalizeHallName(value).replace(/^campus\s+/, '').replace(/[,\s]*\(?(oben|unten)\)?$/, '').trim();
}

function findHall(rawName, halls) {
  if (/\?{2,}|^tba$|^n\/?a$/i.test(rawName)) return null;
  const normalized = normalizeHallName(rawName);
  const exact = halls.filter(hall => normalizeHallName(hall.name) === normalized);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  // A missing floor is not evidence of the same court, even with one candidate.
  // Name variants belong in the manually confirmed mapping table.
  return null;
}

module.exports = { normalizeHallName, candidateName, findHall };
