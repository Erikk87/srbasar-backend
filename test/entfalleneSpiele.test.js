jest.mock('../src/models', () => ({
  Spiel: {
    sequelize: {
      transaction: jest.fn()
    },
    destroy: jest.fn(),
    findOrCreate: jest.fn()
  },
  Verein: {
    findOrCreate: jest.fn()
  },
  SrQualifikation: {
    findOrCreate: jest.fn()
  }
}));

const { Op } = require('sequelize');
const { Spiel, Verein } = require('../src/models');
const teamSLService = require('../src/services/teamSLService');

const verein = { vereinId: 1, vereinsname: 'Testverein' };

function offenesSpiel(spielplanId, zusatz = {}) {
  return {
    sr1OffenAngeboten: true,
    sr2OffenAngeboten: false,
    sr3OffenAngeboten: false,
    sp: {
      spielplanId,
      spieldatum: 1800000000000,
      sr1Verein: verein,
      liga: { liganame: 'Regionsklasse U18 männlich' },
      spielfeld: { bezeichnung: 'Halle', strasse: 'Straße 1', plz: '31848', ort: 'Bad Münder' }
    },
    ...zusatz
  };
}

function geloeschteIds() {
  return Spiel.destroy.mock.calls.map(([{ where }]) => where.spielplanId[Op.eq]);
}

function gespeicherteIds() {
  return Spiel.findOrCreate.mock.calls.map(([{ where }]) => where.spielplanId);
}

describe('Entfallene Spiele (Rückzug eines Teams, Absage)', () => {
  let transaction;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    transaction = { commit: jest.fn(), rollback: jest.fn() };
    Spiel.sequelize.transaction.mockResolvedValue(transaction);
    Spiel.destroy.mockResolvedValue(1);
    Spiel.findOrCreate.mockResolvedValue([{ update: jest.fn() }, true]);
    Verein.findOrCreate.mockResolvedValue([{ update: jest.fn() }, true]);
    teamSLService.detailPauseMs = 0;
    teamSLService.geocodingService.geocodeAddress = jest.fn().mockResolvedValue(null);
  });

  describe('Signal aus TeamSL', () => {
    function holeSpiel(match, game1 = {}) {
      const kickoffDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      jest.spyOn(teamSLService, 'fetchAllLigen').mockResolvedValue([{ ligaId: 54542, liganame: 'Testliga' }]);
      jest.spyOn(teamSLService, 'fetchMatchesForLiga').mockResolvedValue([{ matchId: 2874345, kickoffDate, ...match }]);
      jest.spyOn(teamSLService, 'ensureAuthenticated').mockResolvedValue();
      jest.spyOn(teamSLService, 'fetchGameDetails').mockResolvedValue({
        game1: { spielplanId: 2874345, ...game1 },
        sr2: { offenAngeboten: true }
      });
      return teamSLService.fetchAllOpenGames(100, 'w1').then(({ results }) => results[0]);
    }

    test.each([
      ['verzicht im Spielplan', { verzicht: true }, {}],
      ['abgesagt im Spielplan', { abgesagt: true }, {}],
      ['verzicht in den Spieldetails', {}, { verzicht: true }],
      ['abgesagt in den Spieldetails', {}, { abgesagt: true }]
    ])('%s markiert das Spiel als entfallen', async (_, match, game1) => {
      await expect(holeSpiel(match, game1)).resolves.toMatchObject({ entfallen: true });
    });

    test('ein normales Spiel ist nicht entfallen, auch wenn der SR-Platz offen ist', async () => {
      const spiel = await holeSpiel({ verzicht: false, abgesagt: false }, { verzicht: false, abgesagt: false });

      expect(spiel.entfallen).toBe(false);
      expect(spiel.sr2OffenAngeboten).toBe(true);
    });
  });

  describe('Speichern', () => {
    test.each(['w1', 'w3', 'all'])('%s: entfernt ein entfallenes Spiel trotz offenem SR-Platz', async (zeitraum) => {
      const result = await teamSLService.saveGamesToDatabase(
        [offenesSpiel(2874345, { entfallen: true }), offenesSpiel(2874364, { entfallen: false })],
        zeitraum
      );

      expect(geloeschteIds()).toContain(2874345);
      expect(gespeicherteIds()).toEqual([2874364]);
      expect(result).toMatchObject({
        savedGames: 1,
        skippedGames: 1,
        skippedReasons: expect.objectContaining({ entfallen: 1, notOffered: 0 })
      });
      expect(transaction.commit).toHaveBeenCalled();
    });

    test('lässt Spiele anderer Teams unberührt', async () => {
      await teamSLService.saveGamesToDatabase([offenesSpiel(2874364, { entfallen: false })], 'w1');

      expect(Spiel.destroy).not.toHaveBeenCalled();
      expect(gespeicherteIds()).toEqual([2874364]);
    });

    test('nimmt ein Spiel wieder auf, wenn TeamSL den Rückzug zurücknimmt', async () => {
      await teamSLService.saveGamesToDatabase([offenesSpiel(2874345, { entfallen: true })], 'w1');
      expect(gespeicherteIds()).toEqual([]);

      await teamSLService.saveGamesToDatabase([offenesSpiel(2874345, { entfallen: false })], 'w1');
      expect(gespeicherteIds()).toEqual([2874345]);
    });
  });

  test('ermittelt für entfallene Spiele keine Koordinaten', () => {
    expect(teamSLService.isGameOffered(offenesSpiel(1, { entfallen: true }))).toBe(false);
    expect(teamSLService.isGameOffered(offenesSpiel(2, { entfallen: false }))).toBe(true);
  });
});
