import { MysqlProvisioner } from './mysql.provisioner';
import { DockerRunner } from './docker-runner';
import type { ConfigService } from '@nestjs/config';

describe('MysqlProvisioner', () => {
  const mockRunner = (): DockerRunner => ({
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

  const mockConfig = (host = 'db.example.test'): ConfigService => ({
    get: jest.fn((key: string, fallback?: string) => key === 'MANAGED_DATABASE_HOST' ? host : fallback),
  } as unknown as ConfigService);

  it('waits until MySQL accepts connections before returning credentials', async () => {
    const runner = mockRunner();
    const config = mockConfig();
    const provisioner = new MysqlProvisioner(runner, config);

    const result = await provisioner.provision({
      instanceId: 'db-1', databaseName: 'shop', username: 'ada@example.com', password: 'secret',
    });

    expect(runner.waitForCommand).toHaveBeenCalledWith(
      'big-o-mysql-db-1',
      ['mysqladmin', 'ping', '-h', '127.0.0.1', '-uada@example.com', '-psecret'],
    );
    expect(runner.prepareInstance).toHaveBeenCalledWith('db-1');
    expect(runner.applyUserDataQuota).toHaveBeenCalledWith('db-1');
    const applyOrder = (runner.applyUserDataQuota as jest.Mock).mock.invocationCallOrder[0];
    const waitOrder = (runner.waitForCommand as jest.Mock).mock.invocationCallOrder[0];
    expect(applyOrder).toBeGreaterThan(waitOrder);
    expect(runner.run).toHaveBeenCalledWith(expect.arrayContaining(['run', '--publish', '3306']));
    expect(result).toEqual({ host: 'db.example.test', port: 34601, username: 'ada@example.com' });
  });

  it('refuses to create a database when no public host is configured', async () => {
    const runner = {
      prepareInstance: jest.fn(),
      run: jest.fn(),
      waitForHealthy: jest.fn(),
      publishedPort: jest.fn(),
    } as unknown as DockerRunner;
    const config = mockConfig('');
    const provisioner = new MysqlProvisioner(runner, config);

    await expect(provisioner.provision({ instanceId: 'db-1', databaseName: 'shop', username: 'ada@example.com', password: 'secret' }))
      .rejects.toThrow('MANAGED_DATABASE_HOST must be configured');

    expect(runner.prepareInstance).not.toHaveBeenCalled();
  });

  it('creates a bridge network that permits publishing the user database port', async () => {
    const runner = {
      prepareInstance: jest.fn().mockResolvedValue(undefined),
      applyUserDataQuota: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockImplementation((args: string[]) => args[0] === 'network' && args[1] === 'inspect'
        ? Promise.reject(new Error('network missing'))
        : Promise.resolve('')),
      waitForHealthy: jest.fn().mockResolvedValue(undefined),
      waitForCommand: jest.fn().mockResolvedValue(undefined),
      publishedPort: jest.fn().mockResolvedValue(34601),
    } as unknown as DockerRunner;
    const config = mockConfig();
    const provisioner = new MysqlProvisioner(runner, config);

    await provisioner.provision({ instanceId: 'db-1', databaseName: 'shop', username: 'ada@example.com', password: 'secret' });

    expect(runner.run).toHaveBeenCalledWith(['network', 'create', 'big-o-private']);
  });

  it('removes both its container and quota-managed data on cleanup', async () => {
    const runner = {
      remove: jest.fn().mockResolvedValue(undefined),
      cleanupInstance: jest.fn().mockResolvedValue(undefined),
    } as unknown as DockerRunner;
    const config = mockConfig('');
    const provisioner = new MysqlProvisioner(runner, config);

    await provisioner.destroy('db-1');

    expect(runner.remove).toHaveBeenCalledWith('big-o-mysql-db-1');
    expect(runner.cleanupInstance).toHaveBeenCalledWith('db-1');
  });
});
