const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const dotenv = require('dotenv');

function parseSheetUrl(value) {
  const url = new URL(value);
  const match = url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !match || url.username || url.password) {
    throw new Error('BALLERSCLUB_SHEET_URL muss ein https://docs.google.com/spreadsheets/d/... Link sein');
  }
  const gid = url.searchParams.get('gid') || new URLSearchParams(url.hash.slice(1)).get('gid') || '0';
  if (!/^\d+$/.test(gid)) throw new Error('Ungültige Google-Sheet gid');
  return { id: match[1], gid, exportUrl: `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx&gid=${gid}` };
}

function parseConfig(env) {
  const enabled = env.BALLERSCLUB_ENABLED !== 'false' && Boolean(env.BALLERSCLUB_SHEET_URL);
  if (!enabled) return { enabled: false };
  const sheet = parseSheetUrl(env.BALLERSCLUB_SHEET_URL);
  const daysAhead = Number(env.BALLERSCLUB_DAYS_AHEAD || 21);
  if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 366) throw new Error('BALLERSCLUB_DAYS_AHEAD muss 1–366 sein');
  const phone = String(env.BALLERSCLUB_PHONE || '').replace(/[+\s()-]/g, '');
  const email = String(env.BALLERSCLUB_EMAIL || '').trim();
  const name = String(env.BALLERSCLUB_CONTACT_NAME || '').trim();
  if (!/^[1-9]\d{6,14}$/.test(phone) || email.length > 254 || !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(email) || !name || name.length > 100 || /[\r\n]/.test(name)) {
    throw new Error('Ungültige Ballers-Club-Kontaktdaten');
  }
  return { enabled, sheet, daysAhead, sheetName: env.BALLERSCLUB_SHEET_NAME || '',
    sourceKey: createHash('sha256').update(`${sheet.id}:${sheet.gid}`).digest('hex'),
    refreshMs: 5 * 60 * 1000, maxAgeMs: 15 * 60 * 1000, contact: { phone, email, name } };
}

function loadConfig() {
  const filename = process.env.BALLERSCLUB_ENV_FILE || path.resolve(__dirname, '../../../.env.ballersclub');
  let fileEnv = {};
  try { fileEnv = dotenv.parse(fs.readFileSync(filename)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return parseConfig({ ...fileEnv, ...process.env });
}

module.exports = { loadConfig, parseConfig, parseSheetUrl };
