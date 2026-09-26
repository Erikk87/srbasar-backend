jest.mock('../src/config/database', () => ({ sequelize: {} }));
jest.mock('../src/models', () => ({ Spiel: {} }));
const { Op } = require('sequelize');
const { backfillLocations } = require('../ops/backfillLocations');

const venue = { spielStrasse: 'Münchener Straße 49', spielPlz: '10779', spielOrt: 'Berlin' };
const missing = (id) => ({ ...venue, spielplanId: id, spielLatitude: null, spielLongitude: null });

test('geocodes one address once and only updates missing coordinate fields', async () => {
  const model = { findAll: jest.fn().mockResolvedValue([missing(1), missing(2)]), update: jest.fn().mockResolvedValue([1]) };
  const geocoder = { geocodeAddress: jest.fn().mockResolvedValue({ latitude: 52.49, longitude: 13.34 }) };
  await expect(backfillLocations({ model, geocoder })).resolves.toMatchObject({ updated: 2, unresolved: 0 });
  expect(geocoder.geocodeAddress).toHaveBeenCalledTimes(1);
  expect(model.update).toHaveBeenCalledTimes(2);
  for (const [values, options] of model.update.mock.calls) {
    expect(values).toEqual({ spielLatitude: 52.49, spielLongitude: 13.34 });
    expect(options.where).toMatchObject(venue);
    expect(options.where[Op.or]).toEqual([{ spielLatitude: null }, { spielLongitude: null }]);
    expect(options.silent).toBe(true);
  }
});

test('reuses stored coordinates and does not touch already geocoded games', async () => {
  const stored = { ...missing(1), spielLatitude: 52.49, spielLongitude: 13.34 };
  const model = { findAll: jest.fn().mockResolvedValue([stored, missing(2)]), update: jest.fn().mockResolvedValue([1]) };
  const geocoder = { geocodeAddress: jest.fn() };
  await expect(backfillLocations({ model, geocoder })).resolves.toMatchObject({ updated: 1 });
  expect(geocoder.geocodeAddress).not.toHaveBeenCalled();
  expect(model.update.mock.calls[0][1].where.spielplanId).toBe(2);
  model.findAll.mockResolvedValue([stored]);
  model.update.mockClear();
  await backfillLocations({ model, geocoder });
  expect(model.update).not.toHaveBeenCalled();
});

test('never stores a fabricated zero location on geocoding failure', async () => {
  const model = { findAll: jest.fn().mockResolvedValue([missing(1)]), update: jest.fn() };
  const geocoder = { geocodeAddress: jest.fn().mockRejectedValue(new Error('unavailable')) };
  await expect(backfillLocations({ model, geocoder })).rejects.toThrow('Keine Hallenkoordinaten');
  expect(model.update).not.toHaveBeenCalled();
});
