const { getCoordinates } = require('../src/utils/coordinates');
const { isValidCoordinates, GeocodingService } = require('../src/services/geocodingService');
const { getRadiusKm } = require('../src/utils/spielQuery');

test.each([null, undefined, '', ' ', false, [], ['52'], {}, Infinity, 'NaN'])('rejects missing or malformed coordinates: %j', (value) => {
  expect(getCoordinates(value, 13)).toBeNull();
  expect(getCoordinates(52, value)).toBeNull();
  expect(isValidCoordinates({ latitude: value, longitude: 13 })).toBe(false);
});

test('accepts real zero coordinates and bounds without coercing null to zero', () => {
  expect(getCoordinates('0', 0)).toEqual({ latitude: 0, longitude: 0 });
  expect(getCoordinates(-90, 180)).toEqual({ latitude: -90, longitude: 180 });
  expect(getCoordinates(91, 13)).toBeNull();
  expect(getCoordinates(52, -181)).toBeNull();
  expect(new GeocodingService().extractCoordinates({ features: [{ geometry: { coordinates: [null, null] } }] })).toBeNull();
});

test.each([null, undefined, '', false, [], ['2'], 0, -1, 501, '2; DROP TABLE spiele'])('rejects invalid radii: %j', (value) => {
  expect(getRadiusKm(value)).toBeNull();
});

test('accepts small fractional radii', () => {
  expect(getRadiusKm('0.5')).toBe(0.5);
  expect(getRadiusKm('2')).toBe(2);
});
