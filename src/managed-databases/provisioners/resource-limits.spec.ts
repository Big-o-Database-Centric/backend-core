import { MysqlProvisioner } from './mysql.provisioner';
import { PostgresqlProvisioner } from './postgresql.provisioner';

const input = { instanceId: 'db-1', databaseName: 'shop', username: 'ada@example.com', password: 'Aa1!secret' };

const createRunner = () => ({
  prepareInstance: jest.fn().mockResolvedValue(undefined),
  applyUserDataQuota: jest.fn().mockResolvedValue(undefined),
  cleanupInstance: jest.fn().mockResolvedValue(undefined),
  run: jest.fn().mockResolvedValue(''),
  waitForHealthy: jest.fn().mockResolvedValue(undefined),
  waitForCommand: jest.fn().mockResolvedValue(undefined),
  publishedPort: jest.fn().mockResolvedValue(34601),
  remove: jest.fn().mockResolvedValue(undefined),
});

const config = { get: jest.fn((key, fallback) => key === 'MANAGED_DATABASE_HOST' ? 'db.example.test' : fallback) };

describe('managed database resource limits', () => {
  it.each([
    ['MySQL', MysqlProvisioner, '512m'],
    ['PostgreSQL', PostgresqlProvisioner, '256m'],
  ])('%s starts with its memory and CPU limits', async (_, Provisioner, memory) => {
    const runner = createRunner();
    const provisioner = new Provisioner(runner as any, config as any);

    await provisioner.provision(input);

    expect(runner.run).toHaveBeenCalledWith(expect.arrayContaining([
      '--memory', memory, '--cpus', '0.5',
    ]));
  });
});
