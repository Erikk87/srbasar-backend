jest.mock('../src/models', () => ({
  Spiel: {
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    count: jest.fn()
  },
  Verein: {},
  SrQualifikation: {}
}));

const { Op } = require('sequelize');
const { Spiel } = require('../src/models');
const spieleController = require('../src/controllers/spieleController');

function createResponse() {
  return {
    json: jest.fn(),
    status: jest.fn().mockReturnThis()
  };
}

function createGame(overrides = {}) {
  return {
    toJSON: () => ({
      spielplanId: 1,
      spieldatum: '1789200000000',
      bezirkName: 'Bezirk Süd',
      rawData: {},
      ...overrides
    })
  };
}

describe('Bezirk-Filter (ENABLE_BEZIRK_FILTER)', () => {
  const originalFlag = process.env.ENABLE_BEZIRK_FILTER;

  beforeEach(() => {
    jest.clearAllMocks();
    Spiel.findAll.mockResolvedValue([
      { spielfeldName: 'Halle A', ligaName: 'Oberliga', bezirkName: 'Bezirk Süd', spieldatum: 1789200000000 },
      { spielfeldName: 'Halle B', ligaName: 'Kreisliga', bezirkName: 'Bezirk Nord', spieldatum: 1789286400000 }
    ]);
    Spiel.findAndCountAll.mockResolvedValue({ count: 1, rows: [createGame()] });
    Spiel.count.mockResolvedValue(0);
  });

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.ENABLE_BEZIRK_FILTER;
    else process.env.ENABLE_BEZIRK_FILTER = originalFlag;
  });

  describe('aktiviert', () => {
    beforeEach(() => { process.env.ENABLE_BEZIRK_FILTER = 'true'; });

    test('liefert Bezirke als verfügbare Filter und im Spiel aus', async () => {
      const response = createResponse();
      await spieleController.getAllSpiele({ query: {} }, response);

      const { data } = response.json.mock.calls[0][0];
      expect(data.availableFilters.bezirkName).toEqual(['Bezirk Nord', 'Bezirk Süd']);
      expect(data.spiele[0].bezirkName).toBe('Bezirk Süd');
      expect(Spiel.findAll.mock.calls[0][0].attributes).toContain('bezirkName');
    });

    test('filtert per Teilstring und per Mehrfachauswahl', async () => {
      await spieleController.getAllSpiele({ query: { bezirkName: ' Süd ' } }, createResponse());
      expect(Spiel.findAndCountAll.mock.calls[0][0].where.bezirkName).toEqual({ [Op.like]: '%Süd%' });

      await spieleController.getAllSpiele({ query: { bezirkNames: 'Bezirk Süd,Bezirk Nord' } }, createResponse());
      expect(Spiel.findAndCountAll.mock.calls[1][0].where.bezirkName).toEqual({ [Op.in]: ['Bezirk Süd', 'Bezirk Nord'] });
    });

    test('bezieht Bezirk in die Volltextsuche ein und erlaubt Sortierung', async () => {
      await spieleController.getAllSpiele({ query: { search: 'Nord', sortBy: 'bezirkName' } }, createResponse());

      const query = Spiel.findAndCountAll.mock.calls[0][0];
      const searchConditions = query.where[Op.and][0][Op.or];
      expect(searchConditions).toContainEqual({ bezirkName: { [Op.like]: '%Nord%' } });
      expect(query.order[0]).toEqual(['bezirkName', 'ASC']);
    });
  });

  describe('deaktiviert', () => {
    beforeEach(() => { process.env.ENABLE_BEZIRK_FILTER = 'false'; });

    test('ignoriert Bezirk-Parameter und blendet das Feld aus', async () => {
      const response = createResponse();
      await spieleController.getAllSpiele({
        query: { bezirkName: 'Süd', search: 'Nord', sortBy: 'bezirkName' }
      }, response);

      const query = Spiel.findAndCountAll.mock.calls[0][0];
      expect(query.where.bezirkName).toBeUndefined();
      expect(query.where[Op.and][0][Op.or]).not.toContainEqual({ bezirkName: { [Op.like]: '%Nord%' } });
      expect(query.order[0][0]).not.toBe('bezirkName');

      const { data } = response.json.mock.calls[0][0];
      expect(data.availableFilters.bezirkName).toBeUndefined();
      expect(data.spiele[0].bezirkName).toBeUndefined();
    });
  });
});
