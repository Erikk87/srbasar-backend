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
      rawData: {},
      ...overrides
    })
  };
}

describe('SpieleController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Spiel.findAll.mockResolvedValue([
      { spielfeldName: 'Halle A', ligaName: 'Oberliga', srLizenz: 'LSE', spieldatum: 1789200000000 },
      { spielfeldName: 'Halle B', ligaName: 'Landesliga', srLizenz: 'LSD', spieldatum: 1789286400000 }
    ]);
    Spiel.findAndCountAll.mockResolvedValue({
      count: 1,
      rows: [createGame()]
    });
    Spiel.count.mockResolvedValue(0);
  });

  test.each([
    { nearbyOnly: 'true' },
    { latitude: '999', longitude: '13', radiusKm: '2' },
    { latitude: '52', radiusKm: '2' },
    { latitude: '', longitude: '' },
    { latitude: '52', longitude: '13', radiusKm: '0' },
    { latitude: '52', longitude: '13', radiusKm: ['2'] },
    { nearbyOnly: 'yes' },
    { sortBy: 'distance' }
  ])('rejects invalid location queries instead of silently ignoring them: %j', async (query) => {
    const response = createResponse();
    await spieleController.getAllSpiele({ query }, response);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(Spiel.findAndCountAll).not.toHaveBeenCalled();
  });

  test('returns real distances and preserves unknown distances as null', async () => {
    Spiel.findAndCountAll.mockResolvedValue({ count: 2, rows: [
      createGame({ distanceKm: '1.234' }), createGame({ spielplanId: 2, distanceKm: null })
    ] });
    const response = createResponse();
    await spieleController.getAllSpiele({ query: { latitude: '52', longitude: '13' } }, response);
    expect(response.json.mock.calls[0][0].data.spiele.map((game) => game.distanceKm)).toEqual([1.234, null]);
    expect(Spiel.findAndCountAll.mock.calls[0][0].where[Op.and]).toBeUndefined();
  });

  test('passes search, date range, hall multi-select and stable team sorting to Sequelize', async () => {
    const response = createResponse();

    await spieleController.getAllSpiele({
      query: {
        page: '2',
        limit: '10',
        dateFrom: '2026-09-08',
        dateTo: '2026-09-14',
        spielfeldNames: 'Halle A,Halle B',
        search: 'Nord',
        sortBy: 'homeTeam',
        sortOrder: 'DESC'
      }
    }, response);

    const query = Spiel.findAndCountAll.mock.calls[0][0];
    expect(query.limit).toBe(10);
    expect(query.offset).toBe(10);
    expect(query.where.spielfeldName[Op.in]).toEqual(['Halle A', 'Halle B']);
    expect(query.where.spieldatum[Op.between]).toHaveLength(2);
    expect(query.where[Op.and]).toEqual(expect.arrayContaining([
      expect.objectContaining({ [Op.or]: expect.any(Array) })
    ]));
    expect(query.order).toEqual([
      ['heimMannschaftName', 'DESC'],
      ['spieldatum', 'ASC'],
      ['spielfeldName', 'ASC']
    ]);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('groups the default order by calendar date, hall and kickoff time', async () => {
    const response = createResponse();

    await spieleController.getAllSpiele({ query: {} }, response);

    const query = Spiel.findAndCountAll.mock.calls[0][0];
    expect(query.order[0][0].val).toBe('DATE(FROM_UNIXTIME(spieldatum / 1000))');
    expect(query.order[0][1]).toBe('ASC');
    expect(query.order[1]).toEqual(['spielfeldName', 'ASC']);
    expect(query.order[2]).toEqual(['spieldatum', 'ASC']);
  });

  test('adds server-side distance filtering, distance data and nulls-last sorting', async () => {
    const response = createResponse();

    await spieleController.getAllSpiele({
      query: {
        latitude: '52.52',
        longitude: '13.405',
        radiusKm: '25',
        nearbyOnly: 'true',
        sortBy: 'distance',
        sortOrder: 'ASC'
      }
    }, response);

    const query = Spiel.findAndCountAll.mock.calls[0][0];
    expect(query.attributes.include[0][1]).toBe('distanceKm');
    expect(query.order[0][0].val).toContain('spiel_latitude');
    expect(query.order[1][0].val).toContain('spiel_longitude');
    expect(query.order[2]).toEqual(['spieldatum', 'ASC']);
    expect(query.order[3]).toEqual(['spielfeldName', 'ASC']);
    expect(query.where[Op.and].some((condition) => condition.val.includes('<= 25'))).toBe(true);
  });

  test('filters both open SR positions before pagination, alongside other filters', async () => {
    const response = createResponse();
    Spiel.findAndCountAll.mockResolvedValue({
      count: 23,
      rows: [createGame({ sr1OffenAngeboten: true, sr2OffenAngeboten: true })]
    });
    await spieleController.getAllSpiele({ query: {
      atRiskOnly: 'true', page: '2', limit: '10', search: 'Berlin',
      date: '2026-09-12', ligaName: 'Oberliga', spielfeldNames: 'Halle A',
      srLizenz: 'LSE', latitude: '52.52', longitude: '13.405', radiusKm: '10',
      sortBy: 'awayTeam', sortOrder: 'DESC'
    } }, response);

    const query = Spiel.findAndCountAll.mock.calls[0][0];
    expect(query.where).toMatchObject({ sr1OffenAngeboten: true, sr2OffenAngeboten: true });
    expect(query.where.spielfeldName[Op.in]).toEqual(['Halle A']);
    expect(query.where.spieldatum[Op.between]).toHaveLength(2);
    expect(query.where.srLizenz[Op.like]).toBe('%LSE%');
    expect(query.where.ligaName[Op.like]).toBe('%Oberliga%');
    expect(query.where[Op.and]).toHaveLength(2);
    expect(query.order[0]).toEqual(['gastMannschaftName', 'DESC']);
    expect(query.limit).toBe(10);
    expect(query.offset).toBe(10);
    const data = response.json.mock.calls[0][0].data;
    expect(data.pagination).toMatchObject({ totalItems: 23, totalPages: 3, currentPage: 2 });
    expect(data.spiele[0].isAtRisk).toBe(true);
  });

  test.each([undefined, false, 'false'])('does not restrict games for atRiskOnly=%s', async (value) => {
    await spieleController.getAllSpiele({ query: { atRiskOnly: value } }, createResponse());
    const query = Spiel.findAndCountAll.mock.calls[0][0];
    expect(query.where.sr1OffenAngeboten).toBeUndefined();
    expect(query.where.sr2OffenAngeboten).toBeUndefined();
  });

  test.each(['yes', '', ['true', 'false'], { value: 'true' }])('rejects malformed risk filters: %j', async (value) => {
    const response = createResponse();
    await spieleController.getAllSpiele({ query: { atRiskOnly: value } }, response);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(Spiel.findAndCountAll).not.toHaveBeenCalled();
  });

  test('reports risk availability within the active filter context', async () => {
    Spiel.findAll.mockResolvedValue([
      { sr1OffenAngeboten: true, sr2OffenAngeboten: true },
      { sr1OffenAngeboten: true, sr2OffenAngeboten: false },
      { sr1OffenAngeboten: false, sr2OffenAngeboten: true },
      { sr1OffenAngeboten: true, sr3OffenAngeboten: true }
    ]);
    Spiel.count.mockResolvedValue(0);
    Spiel.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    const response = createResponse();
    await spieleController.getAllSpiele({ query: {
      search: 'Nicht vorhanden', page: '9', dateFrom: '2026-09-12', dateTo: '2026-09-13',
      atRiskOnly: 'true'
    } }, response);
    expect(response.json.mock.calls[0][0].data.availableFilters.atRiskCount).toBe(0);
    expect(Spiel.findAll.mock.calls[0][0].where).toBeUndefined();
    expect(Spiel.findAll.mock.calls[0][0].attributes).toEqual(expect.arrayContaining(['sr1OffenAngeboten', 'sr2OffenAngeboten']));
    const riskQuery = Spiel.count.mock.calls[0][0].where;
    expect(riskQuery).toMatchObject({ sr1OffenAngeboten: true, sr2OffenAngeboten: true });
    expect(riskQuery[Op.and]).toEqual(expect.arrayContaining([
      expect.objectContaining({ [Op.or]: expect.any(Array) })
    ]));
  });

  test('reports no available risk filter when only one SR position is offered', async () => {
    const response = createResponse();
    await spieleController.getAllSpiele({ query: {} }, response);
    expect(response.json.mock.calls[0][0].data.availableFilters.atRiskCount).toBe(0);
  });

  test('keeps the prepared filter available when the active risk filter is enabled', async () => {
    Spiel.count.mockResolvedValue(2);
    const response = createResponse();
    await spieleController.getAllSpiele({ query: { atRiskOnly: 'true' } }, response);
    expect(response.json.mock.calls[0][0].data.availableFilters.atRiskCount).toBe(2);
  });

  test('preserves SR clubs and distinguishes assigned, unassigned and missing source data', async () => {
    Spiel.findAndCountAll.mockResolvedValue({ count: 1, rows: [createGame({
      sr1VereinName: 'DBV Charlottenburg', sr2VereinName: 'TuS Lichterfelde',
      sr1OffenAngeboten: true, sr2OffenAngeboten: false,
      rawData: JSON.stringify({ sr1: null, sr2: { lizenzNr: 'test' } })
    })] });
    const response = createResponse();
    await spieleController.getAllSpiele({ query: {} }, response);
    expect(response.json.mock.calls[0][0].data.spiele[0]).toMatchObject({
      sr1VereinName: 'DBV Charlottenburg', sr2VereinName: 'TuS Lichterfelde',
      sr1: false, sr2: true, sr3: null, isAtRisk: false
    });
    expect(response.json.mock.calls[0][0].data.spiele[0].rawData).toBeUndefined();
  });
});
