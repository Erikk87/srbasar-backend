jest.mock('../src/models', () => ({
  Spiel: {
    sequelize: {
      transaction: jest.fn()
    },
    destroy: jest.fn(),
    findAll: jest.fn()
  },
  Verein: {
    findOrCreate: jest.fn()
  },
  SrQualifikation: {
    findOrCreate: jest.fn()
  }
}));

const { Spiel } = require('../src/models');
const teamSLService = require('../src/services/teamSLService');
const { getAddressKey } = require('../src/services/geocodingService');

describe('TeamSLService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teamSLService.consecutiveEmptyAllSnapshots = 0;
    teamSLService.detailConcurrency = 2;
    teamSLService.detailPauseMs = 0;
    teamSLService.geocodingService.geocodeAddress = jest.fn();
  });

  test('loads all league pages through the public BBN API', async () => {
    teamSLService.publicClient.request = jest.fn()
      .mockResolvedValueOnce({
        data: {
          data: {
            ligen: [{ ligaId: 101, verbandId: 3 }],
            hasMoreData: true,
            size: 1
          }
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            ligen: [{ ligaId: 102, verbandId: 3 }],
            hasMoreData: false,
            size: 1
          }
        }
      });

    await expect(teamSLService.fetchAllLigen()).resolves.toEqual([
      { ligaId: 101, verbandId: 3 },
      { ligaId: 102, verbandId: 3 }
    ]);
    expect(teamSLService.publicClient.request).toHaveBeenCalledTimes(2);
    expect(teamSLService.publicClient.request.mock.calls[1][0].params).toEqual({
      startAtIndex: 1
    });
  });

  test('fails closed when the league API request fails', async () => {
    teamSLService.publicClient.request = jest.fn()
      .mockRejectedValue(new Error('BBN unavailable'));

    await expect(teamSLService.fetchAllLigen()).rejects.toThrow('BBN unavailable');
  });

  test('never performs orphan removal for an unconfirmed empty snapshot', async () => {
    await expect(
      teamSLService.orphanRemoval([], { id: 'transaction' })
    ).rejects.toThrow('leerer Snapshot');

    expect(Spiel.destroy).not.toHaveBeenCalled();
  });

  test('keeps the database unchanged for an empty partial-period snapshot', async () => {
    await expect(
      teamSLService.saveGamesToDatabase([], 'w1', { sourceComplete: true })
    ).resolves.toMatchObject({
      success: true,
      skipped: true,
      reason: 'empty_snapshot'
    });

    expect(Spiel.sequelize.transaction).not.toHaveBeenCalled();
    expect(Spiel.destroy).not.toHaveBeenCalled();
  });

  test('reuses coordinates already stored for the same venue', async () => {
    Spiel.findAll.mockResolvedValue([
      {
        spielStrasse: 'Hauptstraße 1',
        spielPlz: '38100',
        spielOrt: 'Braunschweig',
        spielLatitude: 52.2689,
        spielLongitude: 10.5268
      }
    ]);

    const games = [
      {
        sr1OffenAngeboten: true,
        sp: {
          spielplanId: 1,
          spielfeld: {
            strasse: 'Hauptstraße 1',
            plz: '38100',
            ort: 'Braunschweig'
          }
        }
      },
      {
        sr1OffenAngeboten: true,
        sp: {
          spielplanId: 2,
          spielfeld: {
            strasse: 'Hauptstraße 1',
            plz: '38100',
            ort: 'Braunschweig'
          }
        }
      }
    ];

    await expect(teamSLService.resolveVenueCoordinates(games)).resolves.toEqual(
      new Map([
        [getAddressKey({ street: 'Hauptstraße 1', postalCode: '38100', city: 'Braunschweig' }), {
          latitude: 52.2689,
          longitude: 10.5268
        }]
      ])
    );
    expect(teamSLService.geocodingService.geocodeAddress).not.toHaveBeenCalled();
  });

  test('does not reuse null database coordinates as a location at zero', async () => {
    Spiel.findAll.mockResolvedValue([{ spielStrasse: 'Straße 1', spielPlz: '10115', spielOrt: 'Berlin', spielLatitude: null, spielLongitude: null }]);
    teamSLService.geocodingService.geocodeAddress.mockResolvedValue({ latitude: 52.5, longitude: 13.4 });
    const coordinates = await teamSLService.resolveVenueCoordinates([{ sr1OffenAngeboten: true, sp: {
      spielplanId: 1, spielfeld: { strasse: 'Straße 1', plz: '10115', ort: 'Berlin' }
    } }]);
    expect(teamSLService.geocodingService.geocodeAddress).toHaveBeenCalledTimes(1);
    expect([...coordinates.values()]).toEqual([{ latitude: 52.5, longitude: 13.4 }]);
  });

  test('geocodes each new venue address only once per sync', async () => {
    Spiel.findAll.mockResolvedValue([]);
    teamSLService.geocodingService.geocodeAddress
      .mockResolvedValueOnce({ latitude: 52.2689, longitude: 10.5268 })
      .mockResolvedValueOnce({ latitude: 52.1576, longitude: 10.4158 });

    const games = [
      {
        sr1OffenAngeboten: true,
        sp: {
          spielplanId: 1,
          spielfeld: { strasse: 'Hauptstraße 1', plz: '38100', ort: 'Braunschweig' }
        }
      },
      {
        sr1OffenAngeboten: true,
        sp: {
          spielplanId: 2,
          spielfeld: { strasse: ' Hauptstraße 1 ', plz: '38100', ort: 'Braunschweig' }
        }
      },
      {
        sr1OffenAngeboten: true,
        sp: {
          spielplanId: 3,
          spielfeld: { strasse: 'Ringstraße 2', plz: '38226', ort: 'Salzgitter' }
        }
      }
    ];

    const coordinates = await teamSLService.resolveVenueCoordinates(games);

    expect(teamSLService.geocodingService.geocodeAddress).toHaveBeenCalledTimes(2);
    expect(coordinates.get(getAddressKey({ street: 'Hauptstraße 1', postalCode: '38100', city: 'Braunschweig' }))).toEqual({
      latitude: 52.2689,
      longitude: 10.5268
    });
    expect(coordinates.get(getAddressKey({ street: 'Ringstraße 2', postalCode: '38226', city: 'Salzgitter' }))).toEqual({
      latitude: 52.1576,
      longitude: 10.4158
    });
  });

  test('does not save a snapshot marked as incomplete', async () => {
    await expect(
      teamSLService.saveGamesToDatabase([], 'all', { sourceComplete: false })
    ).rejects.toThrow('nicht vollständig');

    expect(Spiel.sequelize.transaction).not.toHaveBeenCalled();
  });

  test('does not save an empty full snapshot until it is confirmed twice', async () => {
    const executeResult = {
      success: true,
      gamesCount: 0,
      data: {
        complete: true,
        apiReportedTotal: 0,
        results: []
      }
    };
    jest.spyOn(teamSLService, 'executeCronJob').mockResolvedValue(executeResult);
    const saveGames = jest
      .spyOn(teamSLService, 'saveGamesToDatabase')
      .mockResolvedValue({ success: true });

    const firstResult = await teamSLService.processGamesData('all');
    expect(firstResult.databaseResult).toMatchObject({
      skipped: true,
      reason: 'empty_snapshot_not_confirmed'
    });
    expect(saveGames).not.toHaveBeenCalled();

    await teamSLService.processGamesData('all');
    expect(saveGames).toHaveBeenCalledWith([], 'all', {
      sourceComplete: true,
      allowEmptySnapshot: true
    });
  });

  test('aborts the complete fetch when one game detail fails', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const kickoffDate = tomorrow.toISOString().slice(0, 10);

    jest.spyOn(teamSLService, 'fetchAllLigen').mockResolvedValue([
      { ligaId: 201, liganame: 'Testliga' }
    ]);
    jest.spyOn(teamSLService, 'fetchMatchesForLiga').mockResolvedValue([
      { matchId: 301, kickoffDate },
      { matchId: 302, kickoffDate }
    ]);
    jest.spyOn(teamSLService, 'ensureAuthenticated').mockResolvedValue();
    jest.spyOn(teamSLService, 'fetchGameDetails')
      .mockResolvedValueOnce({ game1: { spielplanId: 301 } })
      .mockRejectedValueOnce(new Error('temporary detail error'));
    jest.spyOn(teamSLService, 'convertGameDetailsToApiFormat')
      .mockReturnValue({ sp: { spielplanId: 301 } });

    await expect(teamSLService.fetchAllOpenGames(100, 'all'))
      .rejects.toThrow('Spieldetails fehlgeschlagen');
  });
});
