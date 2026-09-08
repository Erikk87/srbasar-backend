jest.mock('pm2', () => ({}));
const { disableDeploymentWatch } = require('../ops/disableDeployWatch');

test('closes only backend watchers without restarting apps, even when watch is already false', async () => {
  const call = jest.fn((method, operation, id, callback) => callback(null, { success: true }));
  const client = {
    connect: jest.fn((callback) => callback(null)),
    list: jest.fn((callback) => callback(null, [
      { name: 'other-service', pm_id: 0 },
      { name: 'srbasar-backend', pm_id: 2, pm2_env: { watch: false } },
      { name: 'srbasar-backend', pm_id: 3, pm2_env: { watch: true } }
    ])),
    Client: { client: { call } },
    disconnect: jest.fn()
  };
  await disableDeploymentWatch(client);
  expect(call.mock.calls.map(([method, operation, id]) => [method, operation, id])).toEqual([
    ['stopWatch', 'stopProcessId', 2], ['stopWatch', 'stopProcessId', 3]
  ]);
  expect(client.disconnect).toHaveBeenCalledTimes(1);
});

test('fails closed on RPC errors and still disconnects', async () => {
  const client = {
    connect: (callback) => callback(null),
    list: (callback) => callback(null, [{ name: 'srbasar-backend', pm_id: 2 }]),
    Client: { client: { call: (method, operation, id, callback) => callback(new Error('unavailable')) } },
    disconnect: jest.fn()
  };
  await expect(disableDeploymentWatch(client)).rejects.toThrow('unavailable');
  expect(client.disconnect).toHaveBeenCalledTimes(1);
});
