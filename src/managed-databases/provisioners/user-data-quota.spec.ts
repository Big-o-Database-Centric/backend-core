import { MongodbProvisioner } from './mongodb.provisioner';
import { PostgresqlProvisioner } from './postgresql.provisioner';
import { SqlserverProvisioner } from './sqlserver.provisioner';

const input = { instanceId: 'db-1', databaseName: 'shop', username: 'ada@example.com', password: 'Aa1!secret' };

const createRunner = () => ({
  prepareInstance: jest.fn().mockResolvedValue(undefined),
  applyUserDataQuota: jest.fn().mockResolvedValue(undefined),
  run: jest.fn().mockResolvedValue(''),
  waitForHealthy: jest.fn().mockResolvedValue(undefined),
  waitForCommand: jest.fn().mockResolvedValue(undefined),
  publishedPort: jest.fn().mockResolvedValue(34601),
  remove: jest.fn().mockResolvedValue(undefined),
});

const config = { get: jest.fn((key, fallback) => key === 'MANAGED_DATABASE_HOST' ? 'db.example.test' : fallback) };

describe.each([
  ['PostgreSQL', PostgresqlProvisioner],
  ['MongoDB', MongodbProvisioner],
  ['SQL Server', SqlserverProvisioner],
])('%s user-data quota', (_, Provisioner) => {
  it('applies the quota only after engine initialization', async () => {
    const runner = createRunner();
    const provisioner = new Provisioner(runner as any, config as any);

    await provisioner.provision(input);

    expect(runner.applyUserDataQuota).toHaveBeenCalledWith('db-1');
    expect(runner.applyUserDataQuota.mock.invocationCallOrder[0])
      .toBeGreaterThan(runner.waitForCommand.mock.invocationCallOrder[0]);
  });
});
