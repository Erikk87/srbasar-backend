const { createHash } = require('node:crypto');
const ExcelJS = require('exceljs');
const { parseDatePart } = require('../../utils/spielQuery');

function cellText(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map(part => part.text).join('').trim();
    if ('result' in value) return String(value.result ?? '').trim();
    if (value.text) return String(value.text).trim();
  }
  return String(value).trim();
}

function dateValue(cell) {
  let value = cell?.value;
  if (value?.result !== undefined) value = value.result;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value > 30000 && value < 100000) return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
  const match = String(value || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const candidate = match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : String(value || '');
  return parseDatePart(candidate);
}

function berlinTimestamp(date, time = '00:00') {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = nominal;
  for (let index = 0; index < 3; index++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    timestamp += nominal - rendered;
  }
  return timestamp;
}

function dateWindow(now, daysAhead) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + daysAhead);
  return { today, lastDay: end.toISOString().slice(0, 10) };
}

function isYellow(cell) {
  const fill = cell?.fill;
  return fill?.type === 'pattern' && fill.pattern === 'solid' && (
    String(fill.fgColor?.argb || '').slice(-6).toUpperCase() === 'FFFF00' || fill.fgColor?.indexed === 6
  );
}

function timeRange(value, date) {
  const matches = [...value.matchAll(/\b(\d{1,2})[:.](\d{2})\b/g)].map(match => `${match[1].padStart(2, '0')}:${match[2]}`);
  if (!matches.length && /^(?:tba|offen|n\/?a|noch offen)$/i.test(value.trim())) {
    return { startsAt: berlinTimestamp(date), endsAt: berlinTimestamp(date, '23:59') + 59999, timeLabel: 'Uhrzeit folgt' };
  }
  if (matches.length < 2 || matches.some(time => Number(time.slice(0, 2)) > 23 || Number(time.slice(3)) > 59)) return null;
  const [start, end] = matches;
  if (start >= end) return null;
  return { startsAt: berlinTimestamp(date, start), endsAt: berlinTimestamp(date, end), timeLabel: `${start}–${end}` };
}

function parseWorksheet(sheet, { sourceKey, now = new Date(), daysAhead = 21 }) {
  let columns;
  let headerRow = 0;
  for (let number = 1; number <= Math.min(50, sheet.rowCount); number++) {
    const found = {};
    sheet.getRow(number).eachCell((cell, column) => { found[cellText(cell).toLowerCase()] = column; });
    if (['datum', 'uhrzeit', 'halle', 'typ', 'schiedsrichter'].every(key => found[key])) { columns = found; headerRow = number; break; }
  }
  if (!columns) throw new Error('sheet_headers_missing');
  if (sheet.rowCount > 10000 || sheet.columnCount > 200) throw new Error('sheet_too_large');
  const blocks = [];
  let current;
  for (let number = headerRow + 1; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number);
    const date = dateValue(row.getCell(columns.datum));
    if (date) {
      current = { date, row: number, type: cellText(row.getCell(columns.typ)), location: cellText(row.getCell(columns.halle)), time: cellText(row.getCell(columns.uhrzeit)), totalSpots: 0, freeSpots: 0, meetingTime: null, seen: new Set() };
      blocks.push(current);
    } else if (cellText(row.getCell(1)) && !cellText(row.getCell(columns.datum))) {
      current = null;
    }
    if (!current) continue;
    const cell = row.getCell(columns.schiedsrichter);
    const master = cell.master || cell;
    if (isYellow(master) && !current.seen.has(master.address)) {
      current.seen.add(master.address);
      current.totalSpots++;
      if (!cellText(master)) current.freeSpots++;
    }
    const note = cellText(row.getCell(columns.uhrzeit));
    if (/treffpunkt/i.test(note)) current.meetingTime = note.slice(0, 255);
  }
  if (!blocks.length) throw new Error('sheet_dates_missing');
  const { today, lastDay } = dateWindow(now, daysAhead);
  const duplicateKeys = new Map();
  const tournaments = [];
  for (const block of blocks) {
    if (block.date < today || block.date > lastDay || /spielfrei|puffer/i.test(block.type)) continue;
    const time = timeRange(block.time, block.date);
    if (!time || !block.type || !block.location || !block.totalSpots) throw new Error('sheet_event_invalid');
    if (time.endsAt < now.getTime()) continue;
    const key = `${sourceKey}|${block.date}|${block.type}|${block.location}|${block.time}`;
    const duplicate = duplicateKeys.get(key) || 0;
    duplicateKeys.set(key, duplicate + 1);
    tournaments.push({ id: createHash('sha256').update(`${key}|${duplicate}`).digest('hex'), sourceKey, sheetRow: block.row, tournamentType: block.type.slice(0, 255), date: block.date, ...time, meetingTime: block.meetingTime, locationRaw: block.location.slice(0, 255), totalSpots: block.totalSpots, freeSpots: block.freeSpots });
  }
  return tournaments;
}

async function parseWorkbook(buffer, options) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 5 * 1024 * 1024 || buffer.slice(0, 2).toString() !== 'PK') throw new Error('sheet_download_invalid');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = options.sheetName ? workbook.getWorksheet(options.sheetName) : workbook.worksheets.length === 1 ? workbook.worksheets[0] : null;
  if (!sheet) throw new Error('sheet_selection_ambiguous');
  return parseWorksheet(sheet, options);
}

module.exports = { parseWorkbook, parseWorksheet, cellText, isYellow, timeRange, dateValue, dateWindow, berlinTimestamp };
