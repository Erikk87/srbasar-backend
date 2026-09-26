jest.mock('../src/config/database', () => ({
  sequelize: {
    authenticate: jest.fn()
  }
}));

const { sequelize } = require('../src/config/database');
const healthService = require('../src/services/healthService');

describe('HealthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reports a healthy database connection', async () => {
    sequelize.authenticate.mockResolvedValue(undefined);

    await expect(healthService.checkDatabaseHealth()).resolves.toEqual({
      status: 'healthy',
      message: 'Datenbankverbindung erfolgreich'
    });
  });

  test('reports an unavailable database connection', async () => {
    sequelize.authenticate.mockRejectedValue(new Error('database unavailable'));

    await expect(healthService.checkDatabaseHealth()).resolves.toEqual({
      status: 'unhealthy',
      message: 'Datenbankverbindung fehlgeschlagen',
      error: 'database unavailable'
    });
  });

  test('marks the overall health as unhealthy when the database is unavailable', async () => {
    sequelize.authenticate.mockRejectedValue(new Error('database unavailable'));

    await expect(healthService.performHealthCheck()).resolves.toMatchObject({
      status: 'unhealthy',
      services: {
        database: {
          status: 'unhealthy'
        }
      }
    });
  });
});
