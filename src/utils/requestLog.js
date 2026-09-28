// NBBV: Zugriffslog ohne Query-String. Die Parameter können Standorte enthalten
// (latitude/longitude der Umkreissuche) und sollen nicht im Log landen.
const morgan = require('morgan');

const pfadOhneQuery = (req) => (req.originalUrl || req.url || '').split('?')[0];

morgan.token('pfad', pfadOhneQuery);

const FORMAT = ':remote-addr - :remote-user [:date[clf]] ":method :pfad HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"';

module.exports = { requestLog: () => morgan(FORMAT), pfadOhneQuery };
