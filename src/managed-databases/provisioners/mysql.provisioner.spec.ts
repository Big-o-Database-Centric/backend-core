import { MysqlProvisioner } from './mysql.provisioner';

describe('MysqlProvisioner', () => {
  it('waits until MySQL accepts connections before returning credentials', async () => {
    const runner = {
      prepareQuota: jest.fn().mockResolvedValue(undefined),
      prepareInstance: jest.fn().mockResolvedValue(undefined),
      applyUserDataQuota: jest.fn().mockResolvedValue(undefined),
      cleanupInstance: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue(''),
      waitForHealthy: jest.fn().mockResolvedValue(undefined),
      waitForCommand: jest.fn().mockResolvedValue(undefined),
      publishedPort: jest.fn().mockResolvedValue(34601),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const config = { get: jest.fn((key, fallback) => key === 'MANAGED_DATABASE_HOST' ? 'db.example.test' : fallback) };
    const provisioner = new MysqlProvisioner(runner as any, config as any);

    const result = await provisioner.provision({
      instanceId: 'db-1', databaseName: 'shop', username: 'ada@example.com', password: 'secret',
    });

    expect(runner.waitForCommand).toHaveBeenCalledWith(
      'big-o-mysql-db-1',
      ['mysqladmin', 'ping', '-h', '127.0.0.1', '-uada@example.com', '-psecret'],
    );
    expect(runner.prepareInstance).toHaveBeenCalledWith('db-1');
    expect(runner.applyUserDataQuota).toHaveBeenCalledWith('db-1');
    expect(runner.applyUserDataQuota.mock.invocationCallOrder[0])
      .toBeGreaterThan(runner.waitForCommand.mock.invocationCallOrder[0]);
    expect(runner.run).toHaveBeenCalledWith(expect.arrayContaining(['run', '--publish', '3306']));
    expect(result).toEqual({ host: 'db.example.test', port: 34601, username: 'ada@example.com' });
  });

  it('refuses to create a database when no public host is configured', async () => {
    const runner = { prepareInstance: jest.fn(), run: jest.fn(), waitForHealthy: jest.fn(), publishedPort: jest.fn() };
    const config = { get: jest.fn((_, fallback) => fallback) };
    const provisioner = new MysqlProvisioner(runner as any, config as any);

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
    };
    const config = { get: jest.fn((key, fallback) => key === 'MANAGED_DATABASE_HOST' ? 'db.example.test' : fallback) };
    const provisioner = new MysqlProvisioner(runner as any, config as any);

    await provisioner.provision({ instanceId: 'db-1', databaseName: 'shop', username: 'ada@example.com', password: 'secret' });

    expect(runner.run).toHaveBeenCalledWith(['network', 'create', 'big-o-private']);
  });

  it('removes both its container and quota-managed data on cleanup', async () => {
    const runner = {
      remove: jest.fn().mockResolvedValue(undefined),
      cleanupInstance: jest.fn().mockResolvedValue(undefined),
    };
    const config = { get: jest.fn((_, fallback) => fallback) };
    const provisioner = new MysqlProvisioner(runner as any, config as any);

    await provisioner.destroy('db-1');

    expect(runner.remove).toHaveBeenCalledWith('big-o-mysql-db-1');
    expect(runner.cleanupInstance).toHaveBeenCalledWith('db-1');
  });
});
