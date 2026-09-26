const {
  getCoordinates,
  getDateRange,
  getDistanceExpression,
  getPagination,
  getSortParameters,
  parseList
} = require('../src/utils/spielQuery');

describe('spielQuery', () => {
  test('parses comma-separated multi-select values without duplicates', () => {
    expect(parseList([' Halle A, Halle B ', 'Halle A'])).toEqual(['Halle A', 'Halle B']);
  });

  test('creates a Berlin-local date range for an exact date', () => {
    const range = getDateRange({ date: '2026-09-08' });
    const formatBerlinDate = (timestamp) => {
      const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
      }).formatToParts(new Date(timestamp));
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return values.year + '-' + values.month + '-' + values.day;
    };

    expect(formatBerlinDate(range.start)).toBe('2026-09-08');
    expect(formatBerlinDate(range.end)).toBe('2026-09-08');
    expect(range.end - range.start).toBe(24 * 60 * 60 * 1000 - 1);
  });

  test('supports open-ended date ranges and rejects invalid dates', () => {
    expect(getDateRange({ dateFrom: '2026-09-22' })).toMatchObject({
      start: expect.any(Number),
      end: null
    });
    expect(getDateRange({ date: '2026-02-30' })).toEqual({ invalid: true });
  });

  test('normalizes sort aliases and pagination safely', () => {
    expect(getSortParameters('homeTeam', 'desc')).toEqual({
      sortBy: 'heimMannschaftName',
      sortOrder: 'DESC'
    });
    expect(getSortParameters('license', 'asc')).toEqual({
      sortBy: 'srLizenz',
      sortOrder: 'ASC'
    });
    expect(getSortParameters('not-allowed', 'not-allowed')).toEqual({
      sortBy: 'spieldatum',
      sortOrder: 'ASC'
    });
    expect(getPagination('0', '1000')).toEqual({
      pageNumber: 1,
      pageSize: 100,
      offset: 0
    });
  });

  test('accepts only valid geographic coordinates and produces a numeric SQL expression', () => {
    expect(getCoordinates('52.52', '13.405')).toEqual({
      latitude: 52.52,
      longitude: 13.405
    });
    expect(getCoordinates('91', '13.405')).toBeNull();
    expect(getDistanceExpression({ latitude: 52.52, longitude: 13.405 })).toContain('spiel_latitude');
  });
});
