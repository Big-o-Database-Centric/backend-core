import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ManagedDatabasesService } from './managed-databases.service';

describe('ManagedDatabasesService', () => {
  const repository = { reserve: jest.fn(), activate: jest.fn(), fail: jest.fn(), list: jest.fn() };
  const provisioner = { engine: 'mysql' as const, provision: jest.fn(), destroy: jest.fn() };
  const cipher = { encrypt: jest.fn().mockReturnValue(Buffer.from('encrypted')) };
  const config = { get: jest.fn((key: string, fallback?: string) => key === 'MANAGED_DATABASE_ENABLED_ENGINES' ? 'mysql,postgresql' : fallback) };
  const service = new (ManagedDatabasesService as any)(repository, [provisioner], cipher, config);

  beforeEach(() => jest.clearAllMocks());

  it('does not call a provisioner when reservation reports the limit', async () => {
    repository.reserve.mockResolvedValue({ Success: false, Message: 'Maximum of 3 active databases reached' });
    await expect(service.create('token', { engine: 'mysql', databaseName: 'shop' })).rejects.toThrow(ConflictException);
    expect(provisioner.provision).not.toHaveBeenCalled();
  });

  it('rejects an absent session', async () => {
    repository.reserve.mockResolvedValue({ Success: false, Message: 'Unauthorized' });
    await expect(service.create(null, { engine: 'mysql', databaseName: 'shop' })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an engine not enabled for the MVP before reserving', async () => {
    await expect(service.create('token', { engine: 'mongodb', databaseName: 'shop' }))
      .rejects.toThrow(ConflictException);

    expect(repository.reserve).not.toHaveBeenCalled();
  });

  it('reports the user-facing limit with the enabled engines', () => {
    expect(service.capabilities()).toEqual({ engines: ['mysql', 'postgresql'], maxPerUser: 3 });
  });

  it('uses the logged-in email as the database username', async () => {
    repository.reserve.mockResolvedValue({ Success: true, DatabaseId: 7, InstanceId: 'instance-7', Email: 'ada@example.com' });
    provisioner.provision.mockResolvedValue({ host: 'mysql', port: 3306, username: 'ada@example.com' });
    repository.activate.mockResolvedValue(true);

    await service.create('token', { engine: 'mysql', databaseName: 'shop' });

    expect(provisioner.provision).toHaveBeenCalledWith(expect.objectContaining({ username: 'ada@example.com' }));
    expect(provisioner.provision.mock.calls[0][0].password).toMatch(/^Aa1![A-Za-z0-9_-]+$/);
  });

  it('fails the reservation before provisioning when the exact email exceeds MySQL user limits', async () => {
    const email = `${'a'.repeat(24)}@example.test`;
    repository.reserve.mockResolvedValue({ Success: true, DatabaseId: 7, InstanceId: 'instance-7', Email: email });

    await expect(service.create('token', { engine: 'mysql', databaseName: 'shop' })).rejects.toThrow(BadRequestException);

    expect(provisioner.provision).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(7, 'Email is too long for a database username');
  });

  it('removes a partially created engine when provisioning fails', async () => {
    repository.reserve.mockResolvedValue({ Success: true, DatabaseId: 7, InstanceId: 'instance-7', Email: 'ada@example.com' });
    provisioner.provision.mockRejectedValue(new Error('engine startup failed'));

    await expect(service.create('token', { engine: 'mysql', databaseName: 'shop' })).rejects.toThrow('Database provisioning failed');

    expect(provisioner.destroy).toHaveBeenCalledWith('instance-7');
    expect(repository.fail).toHaveBeenCalledWith(7, 'Provisioning failed');
  });
});
