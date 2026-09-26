function isGameAtRisk(game) {
  return game.sr1OffenAngeboten === true && game.sr2OffenAngeboten === true;
}

function getRefereePresence(rawData, key) {
  if (!Object.prototype.hasOwnProperty.call(rawData, key)) return null;
  return rawData[key] !== null && rawData[key] !== false;
}

module.exports = { isGameAtRisk, getRefereePresence };
