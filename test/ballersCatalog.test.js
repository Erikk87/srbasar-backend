const { Op } = require('sequelize');
const { sequelize } = require('../src/config/database');
const { Spiel, BallersTournament } = require('../src/models');
const { BasarRepository } = require('../src/repositories/basarRepository');
const { BallersClubService, ballersClubService } = require('../src/modules/ballersclub/service');
const controller = require('../src/controllers/spieleController');
const moduleController = require('../src/modules/ballersclub/controller');

afterEach(() => jest.restoreAllMocks());
const config = { sourceKey: 'sheet', daysAhead: 21 };
const now = new Date('2026-09-11T18:00:00Z');

test('builds one escaped UNION with shared filters and bounded Berlin dates', async () => {
  const query = jest.spyOn(sequelize, 'query').mockResolvedValue([]);
  const repo = new BasarRepository({ config, now });
  await repo.select('entryId', { spielfeldName: { [Op.in]: ["Halle ' OR 1=1 --", 'Efeuweg (oben)'] }, sr1OffenAngeboten: true });
  const [sql, options] = query.mock.calls[0];
  expect(sql).toContain('UNION ALL');
  expect(sql).toContain('t.free_spots > 0');
  expect(sql).toContain('WHERE `spielfeldName` IN');
  expect(sql).toContain("Halle \\' OR 1=1 --");
  expect(sql).toContain('`sr1OffenAngeboten` = true');
  expect(options.replacements).toEqual({ sourceKey: 'sheet', now: now.getTime(), firstDay: Date.parse('2026-09-10T22:00:00Z'), lastDay: Date.parse('2026-10-02T21:59:59.999Z') });
  expect(new BasarRepository({ config, now, source: 'ballers-club' }).projection()).not.toContain('UNION ALL');
});

test('counts and paginates both sources together, then hydrates without ID collisions', async () => {
  const transaction = {};
  jest.spyOn(sequelize, 'transaction').mockImplementation(callback => callback(transaction));
  const query = jest.spyOn(sequelize, 'query').mockResolvedValueOnce([{ total: '24' }]).mockResolvedValueOnce([
    { source: 'ballers-club', entryId: 'ballers-club:1', spielplanId: null, distanceKm: null },
    { source: 'team-sl', entryId: 'team-sl:1', spielplanId: 1, distanceKm: 3 }
  ]);
  jest.spyOn(Spiel, 'findAll').mockResolvedValue([{ spielplanId: 1, toJSON: () => ({ spielplanId: 1, heimMannschaftName: 'Team' }) }]);
  jest.spyOn(BallersTournament, 'findAll').mockResolvedValue([{ toJSON: () => ({ id: '1', startsAt: 1, endsAt: 2, freeSpots: 1, totalSpots: 3, tournamentType: 'U12 Tour', locationRaw: 'Halle' }) }]);
  const result = await new BasarRepository({ config, now }).findAndCountAll({ where: { ligaName: 'U12 Tour' }, limit: 2, offset: 2, sortBy: 'distance', sortOrder: 'ASC', coordinates: { latitude: 52, longitude: 13 } });
  expect(result.count).toBe(24);
  expect(result.rows.map(row => row.toJSON().id)).toEqual(['ballers-club:1', 'team-sl:1']);
  expect(result.rows[0].toJSON()).toMatchObject({ spielplanId: null, freeSpots: 1, distanceKm: null });
  expect(query.mock.calls[1][0]).toMatch(/WHERE `ligaName` = 'U12 Tour' ORDER BY .* LIMIT 2 OFFSET 2/);
  expect(query.mock.calls[1][1].transaction).toBe(transaction);
  expect(Spiel.findAll.mock.calls[0][0].where.spielplanId[Op.in]).toEqual([1]);
});

test('enabled controller uses mixed counts and the module endpoint forces its own source', async () => {
  jest.spyOn(ballersClubService, 'publicState').mockResolvedValue({ enabled: true, available: true, status: 'fresh' });
  jest.spyOn(BasarRepository.prototype, 'filters').mockResolvedValue([{ ligaName: 'U12 Tour' }]);
  jest.spyOn(BasarRepository.prototype, 'count').mockResolvedValue(0);
  const find = jest.spyOn(BasarRepository.prototype, 'findAndCountAll').mockResolvedValue({ count: 21, rows: [{ toJSON: () => ({ id: 'ballers-club:abc', source: 'ballers-club', spieldatum: now.getTime(), freeSpots: 1 }) }] });
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await controller.getAllSpiele({ query: { page: 2, limit: 10 } }, res);
  expect(res.json.mock.calls[0][0].data.pagination).toMatchObject({ totalItems: 21, totalPages: 3, currentPage: 2 });
  expect(find.mock.instances[0].source).toBe('all');
  await moduleController.getSpiele({ query: { source: 'team-sl' } }, res);
  expect(find.mock.instances[1].source).toBe('ballers-club');
});

test('an unavailable module returns no tournaments without hiding TeamSL games', async () => {
  jest.spyOn(ballersClubService, 'publicState').mockResolvedValue({ enabled: true, available: false });
  jest.spyOn(Spiel, 'findAll').mockResolvedValue([]);
  jest.spyOn(Spiel, 'count').mockResolvedValue(0);
  const find = jest.spyOn(Spiel, 'findAndCountAll').mockResolvedValue({ count: 0, rows: [] });
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await moduleController.getSpiele({ query: {} }, res);
  expect(find.mock.calls[0][0].where[Op.and][0].val).toBe('1 = 0');
  await controller.getAllSpiele({ query: {} }, res);
  expect(find.mock.calls[1][0].where[Op.and]).toBeUndefined();
});

test('concurrent refreshes share one download and atomically replace one snapshot', async () => {
  const fetch = jest.fn().mockResolvedValue({ data: Buffer.from('PK') });
  const store = { replaceSnapshot: jest.fn(), recordFailure: jest.fn() };
  const service = new BallersClubService({ config: () => ({ ...config, enabled: true, sheet: { exportUrl: 'https://docs.google.com/x' } }), store, fetch, parse: async () => [] });
  await Promise.all([service.refresh(), service.refresh()]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(store.replaceSnapshot).toHaveBeenCalledTimes(1);
});
