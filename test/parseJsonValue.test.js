const parseJsonValue = require('../src/utils/parseJsonValue');

describe('parseJsonValue', () => {
  test('keeps an already parsed JSON object unchanged', () => {
    const value = { sr1: true };

    expect(parseJsonValue(value)).toBe(value);
  });

  test('parses a JSON string', () => {
    expect(parseJsonValue('{"sr1":true}')).toEqual({ sr1: true });
  });

  test('returns an empty object for invalid or empty values', () => {
    expect(parseJsonValue('[object Object]')).toEqual({});
    expect(parseJsonValue(null)).toEqual({});
    expect(parseJsonValue('')).toEqual({});
  });
});
