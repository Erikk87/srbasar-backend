const { pfadOhneQuery } = require('../src/utils/requestLog');

describe('requestLog', () => {
  test('schreibt keine Query-Parameter (Standort) ins Log', () => {
    expect(pfadOhneQuery({ originalUrl: '/v1/spiele?latitude=51.53&longitude=9.94' })).toBe('/v1/spiele');
    expect(pfadOhneQuery({ url: '/v1/health' })).toBe('/v1/health');
  });
});
