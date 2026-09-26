jest.mock('../src/config/database', () => ({ sequelize: {
  sync: jest.fn(), getQueryInterface: jest.fn()
} }));
jest.mock('../src/models', () => ({}));
const { sequelize } = require('../src/config/database');
const { ensureLocationColumns } = require('../ops/migrate');

test('only adds missing nullable columns and is repeatable without dropping data', async () => {
  const columns = { spielplan_id: {} };
  const queryInterface = {
    describeTable: jest.fn(async () => ({ ...columns })),
    addColumn: jest.fn(async (table, name, definition) => { columns[name] = definition; })
  };
  sequelize.getQueryInterface.mockReturnValue(queryInterface);
  await ensureLocationColumns();
  await ensureLocationColumns();
  expect(sequelize.sync).toHaveBeenCalledWith({ alter: false, force: false });
  expect(queryInterface.addColumn).toHaveBeenCalledTimes(2);
  expect(Object.keys(columns)).toEqual(['spielplan_id', 'spiel_latitude', 'spiel_longitude']);
  for (const [table, , definition] of queryInterface.addColumn.mock.calls) {
    expect(table).toBe('spiele');
    expect(definition.allowNull).toBe(true);
  }
});
