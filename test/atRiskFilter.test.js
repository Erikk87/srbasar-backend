jest.mock('../src/models', () => ({
  Spiel: { findAll: jest.fn(), findAndCountAll: jest.fn(), count: jest.fn() },
  Verein: {}, SrQualifikation: {}
}));

const { Spiel } = require('../src/models');
const { Op } = require('sequelize');
const controller = require('../src/controllers/spieleController');

function response() {
  return { json: jest.fn(), status: jest.fn().mockReturnThis() };
}

describe('risk filter and contextual availability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Spiel.findAll.mockResolvedValue([
      { sr1OffenAngeboten: true, sr2OffenAngeboten: true },
      { sr1OffenAngeboten: true, sr2OffenAngeboten: false },
      { sr1OffenAngeboten: false, sr2OffenAngeboten: true }
    ]);
    Spiel.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    Spiel.count.mockResolvedValue(1);
  });

  test('adds both SR conditions before pagination while preserving search and league filtering', async () => {
    const res = response();
    await controller.getAllSpiele({ query: {
      atRiskOnly: 'true', page: '2', limit: '2', search: 'Berlin', ligaName: 'Oberliga'
    } }, res);
    const query = Spiel.findAndCountAll.mock.calls[0][0];
    expect(query.where).toMatchObject({ sr1OffenAngeboten: true, sr2OffenAngeboten: true });
    expect(query.where.ligaName[Op.like]).toBe('%Oberliga%');
    expect(query.where[Op.and][0][Op.or]).toEqual(expect.arrayContaining([
      { heimMannschaftName: { [Op.like]: '%Berlin%' } }
    ]));
    expect(query.limit).toBe(2);
    expect(query.offset).toBe(2);
    expect(res.json.mock.calls[0][0].data.availableFilters.atRiskCount).toBe(1);
  });

  test.each([undefined, false, 'false'])('does not activate the filter for %s', async (atRiskOnly) => {
    await controller.getAllSpiele({ query: { atRiskOnly } }, response());
    expect(Spiel.findAndCountAll.mock.calls[0][0].where.sr1OffenAngeboten).toBeUndefined();
  });

  test.each(['yes', ['true', 'false'], { value: true }])('rejects malformed input %j', async (atRiskOnly) => {
    const res = response();
    await controller.getAllSpiele({ query: { atRiskOnly } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Spiel.findAndCountAll).not.toHaveBeenCalled();
  });

  test('returns zero availability after the last at-risk game disappears', async () => {
    Spiel.findAll.mockResolvedValue([{ sr1OffenAngeboten: true, sr2OffenAngeboten: false }]);
    Spiel.count.mockResolvedValue(0);
    const res = response();
    await controller.getAllSpiele({ query: {} }, res);
    expect(res.json.mock.calls[0][0].data.availableFilters.atRiskCount).toBe(0);
  });

  test('returns correct risk, pagination and known/unknown SR status', async () => {
    Spiel.findAndCountAll.mockResolvedValue({ count: 5, rows: [{
      toJSON: () => ({
        spieldatum: '1789200000000', sr1OffenAngeboten: true, sr2OffenAngeboten: true,
        sr1VereinName: 'Verein A', sr2VereinName: 'Verein B', rawData: { sr1: null, sr2: null }
      })
    }] });
    const res = response();
    await controller.getAllSpiele({ query: { atRiskOnly: true, limit: '2' } }, res);
    const data = res.json.mock.calls[0][0].data;
    expect(data.pagination).toMatchObject({ totalItems: 5, totalPages: 3 });
    expect(data.spiele[0]).toMatchObject({ isAtRisk: true, sr1: false, sr2: false, sr3: null, sr1VereinName: 'Verein A', sr2VereinName: 'Verein B' });
  });
});
