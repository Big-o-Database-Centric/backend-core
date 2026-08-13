import { MysqlProvisioner } from './mysql.provisioner';
import { PostgresqlProvisioner } from './postgresql.provisioner';
import { DockerRunner } from './docker-runner';
import type { ConfigService } from '@nestjs/config';

const input = { instanceId: 'db-1', databaseName: 'shop', username: 'ada@example.com', password: 'Aa1!secret' };

const createRunner = (): DockerRunner => ({
  run: jest.fn().mockResolvedValue(''),
  remove: jest.fn().mockResolvedValue(undefined),
  waitForHealthy: jest.fn().mockResolvedValue(undefined),
  waitForCommand: jest.fn().mockResolvedValue(undefined),
  publishedPort: jest.fn().mockResolvedValue(34601),
  prepareInstance: jest.fn().mockResolvedValue(undefined),
  applyUserDataQuota: jest.fn().mockResolvedValue(undefined),
  cleanupInstance: jest.fn().mockResolvedValue(undefined),
  runQuotaHelper: jest.fn().mockResolvedValue(undefined),
} as unknown as DockerRunner);

const mockConfig = (): ConfigService => ({
  get: jest.fn((key: string, fallback?: string) => key === 'MANAGED_DATABASE_HOST' ? 'db.example.test' : fallback),
} as unknown as ConfigService);

describe('managed database resource limits', () => {
  it.each([
    ['MySQL', MysqlProvisioner, '512m'],
    ['PostgreSQL', PostgresqlProvisioner, '256m'],
  ])('%s starts with its memory and CPU limits', async (_, Provisioner, memory) => {
    const runner = createRunner();
    const provisioner = new Provisioner(runner, mockConfig());

    await provisioner.provision(input);

    expect(runner.run).toHaveBeenCalledWith(expect.arrayContaining([
      '--memory', memory, '--cpus', '0.5',
    ]));
  });
});
