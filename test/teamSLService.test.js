jest.mock('../src/models', () => ({
  Spiel: {
    sequelize: {
      transaction: jest.fn()
    },
    destroy: jest.fn()
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

describe('TeamSLService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teamSLService.consecutiveEmptyAllSnapshots = 0;
    teamSLService.detailConcurrency = 2;
    teamSLService.detailPauseMs = 0;
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
