const { Hall, Spiel, BallersHallMapping, BallersTournament, GeocodingCache } = require('../src/models');
const { Op } = require('sequelize');
const { sequelize } = require('../src/config/database');
const { resolveHalls, confirmMapping } = require('../src/modules/ballersclub/hallRepository');
const { rememberVenue } = require('../src/repositories/hallRepository');
const geocodingRepository = require('../src/repositories/geocodingRepository');
const { GeocodingService } = require('../src/services/geocodingService');
const { ensureHallHistory } = require('../ops/migrate');

afterEach(() => jest.restoreAllMocks());

test('confirmed mappings update only matching source aliases in the same transaction', async () => {
  const transaction = {};
  jest.spyOn(sequelize, 'transaction').mockImplementation(callback => callback(transaction));
  jest.spyOn(Hall, 'findByPk').mockResolvedValue({ id: 8, name: 'Adalbertstraße, unten' });
  const mapping = { id: 4, update: jest.fn() };
  jest.spyOn(BallersHallMapping, 'findOrCreate').mockResolvedValue([mapping]);
  jest.spyOn(BallersTournament, 'findAll').mockResolvedValue([
    { id: 'a', locationRaw: 'Adalbertstraße' }, { id: 'b', locationRaw: 'Adalbertstraße (Anschluss) <<<<<' }, { id: 'c', locationRaw: 'Arkonaplatz' }
  ]);
  jest.spyOn(BallersTournament, 'update').mockResolvedValue([2]);
  expect(await confirmMapping('source', 'Adalbertstraße', 8)).toMatchObject({ hallId: 8, updatedEvents: 2 });
  expect(mapping.update).toHaveBeenCalledWith(expect.objectContaining({ hallId: 8, manual: true }), { transaction });
  expect(BallersTournament.update.mock.calls[0][1].where.id[Op.in]).toEqual(['a', 'b']);
  expect(BallersTournament.findAll.mock.calls[0][0].where).toEqual({ sourceKey: 'source' });
  await expect(confirmMapping('source', 'Hall', '8;DROP')).rejects.toThrow('Ungültige Hallen-ID');
});

test('manual hall choices and explicit non-matches survive every import', async () => {
  jest.spyOn(Hall, 'findAll').mockResolvedValue([{ id: 3, name: 'Known' }]);
  const assigned = { manual: true, hallId: 3, update: jest.fn() };
  const blocked = { manual: true, hallId: null, update: jest.fn() };
  const lookup = jest.spyOn(BallersHallMapping, 'findOrCreate').mockResolvedValueOnce([assigned]).mockResolvedValueOnce([blocked]);
  const result = await resolveHalls([{ locationRaw: 'Alias' }, { locationRaw: 'Alias (Anschluss)' }, { locationRaw: 'Known' }], 'source', {});
  expect(result.map(row => row.hallId)).toEqual([3, 3, null]);
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(assigned.update.mock.calls[0][0]).not.toHaveProperty('hallId');
  expect(blocked.update.mock.calls[0][0]).not.toHaveProperty('hallId');
});

test('history updates retain existing coordinates when a source omits them', async () => {
  const hall = { id: 8, update: jest.fn() };
  jest.spyOn(Hall, 'findOrCreate').mockResolvedValue([hall, false]);
  await rememberVenue({ name: 'Halle', street: 'Straße 1', city: 'Berlin' });
  expect(hall.update.mock.calls[0][0]).not.toHaveProperty('latitude');
  expect(hall.update.mock.calls[0][0]).not.toHaveProperty('longitude');
});

test('hall migration is additive, repeatable and links existing games', async () => {
  const columns = {};
  const queryInterface = { describeTable: jest.fn(async () => columns), addColumn: jest.fn(async (table, name, definition) => { columns[name] = definition; }) };
  jest.spyOn(sequelize, 'getQueryInterface').mockReturnValue(queryInterface);
  jest.spyOn(Spiel, 'findAll').mockResolvedValue([{ spielplanId: 1, spielfeldName: 'Halle', spielStrasse: 'Straße 1', spielOrt: 'Berlin', hallId: null }]);
  jest.spyOn(Hall, 'findOrCreate').mockResolvedValue([{ id: 8 }, true]);
  jest.spyOn(Spiel, 'update').mockResolvedValue([1]);
  await ensureHallHistory();
  await ensureHallHistory();
  expect(queryInterface.addColumn).toHaveBeenCalledTimes(1);
  expect(columns.hall_id).toMatchObject({ allowNull: true, onDelete: 'SET NULL', references: { model: 'hallen', key: 'id' } });
  expect(Spiel.update).toHaveBeenCalledWith({ hallId: 8 }, { where: { spielplanId: 1 } });
});

test('persistent positive and negative cache entries avoid external geocoding requests', async () => {
  const service = new GeocodingService({ repository: geocodingRepository });
  const request = jest.spyOn(service.client, 'get');
  const lookup = jest.spyOn(GeocodingCache, 'findByPk').mockResolvedValue({ status: 'success', latitude: 52, longitude: 13 });
  const address = { street: 'Straße 1', postalCode: '10179', city: 'Berlin' };
  expect(await service.geocodeAddress(address)).toEqual({ latitude: 52, longitude: 13 });
  lookup.mockResolvedValue({ status: 'not-found', retryAfter: new Date(Date.now() + 60000) });
  expect(await service.geocodeAddress(address)).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

test('negative cache expires, takes a single database lease and records a retry window', async () => {
  jest.spyOn(GeocodingCache, 'findByPk').mockResolvedValue({ status: 'not-found', retryAfter: new Date(Date.now() - 1) });
  expect((await geocodingRepository.lookup('address')).hit).toBe(false);
  jest.spyOn(GeocodingCache, 'findOrCreate').mockResolvedValue([{}, false]);
  jest.spyOn(GeocodingCache, 'update').mockResolvedValue([0]);
  expect(await geocodingRepository.claim('address')).toBe(false);
  jest.spyOn(GeocodingCache, 'upsert').mockResolvedValue([]);
  await geocodingRepository.save('address', null, true);
  const value = GeocodingCache.upsert.mock.calls[0][0];
  expect(value.status).toBe('error');
  expect(value.retryAfter.getTime() - Date.now()).toBeGreaterThan(890000);
  expect(value.key).not.toContain('address');
});
