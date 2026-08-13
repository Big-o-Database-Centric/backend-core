import { MongodbProvisioner } from './mongodb.provisioner';
import { PostgresqlProvisioner } from './postgresql.provisioner';
import { SqlserverProvisioner } from './sqlserver.provisioner';
import { DockerRunner } from './docker-runner';
import type { ConfigService } from '@nestjs/config';

const input = { instanceId: 'db-1', databaseName: 'shop', username: 'ada@example.com', password: 'Aa1!secret' };

const createRunner = (): DockerRunner => ({
  run: jest.fn<Promise<string>, [string[]]>().mockResolvedValue(''),
  remove: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  waitForHealthy: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  waitForCommand: jest.fn<Promise<void>, [string, string[]]>().mockResolvedValue(undefined),
  publishedPort: jest.fn<Promise<number>, [string, number]>().mockResolvedValue(34601),
  prepareInstance: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  applyUserDataQuota: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  cleanupInstance: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  runQuotaHelper: jest.fn<Promise<void>, [string, string, string]>().mockResolvedValue(undefined),
} as unknown as DockerRunner);

const mockConfig = (): ConfigService => ({
  get: jest.fn((key: string, fallback?: string) => key === 'MANAGED_DATABASE_HOST' ? 'db.example.test' : fallback),
} as unknown as ConfigService);

describe.each([
  ['PostgreSQL', PostgresqlProvisioner],
  ['MongoDB', MongodbProvisioner],
  ['SQL Server', SqlserverProvisioner],
])('%s user-data quota', (_, Provisioner) => {
  it('applies the quota only after engine initialization', async () => {
    const runner = createRunner();
    const provisioner = new Provisioner(runner, mockConfig());

    await provisioner.provision(input);

    expect(runner.applyUserDataQuota).toHaveBeenCalledWith('db-1');
    const applyOrder = (runner.applyUserDataQuota as jest.Mock).mock.invocationCallOrder[0];
    const waitOrder = (runner.waitForCommand as jest.Mock).mock.invocationCallOrder[0];
    expect(applyOrder).toBeGreaterThan(waitOrder);
  });
});
