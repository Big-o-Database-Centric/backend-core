import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ManagedDatabasesService } from './managed-databases.service';

describe('ManagedDatabasesService', () => {
  const repository = { reserve: jest.fn(), activate: jest.fn(), fail: jest.fn(), list: jest.fn() };
  const provisioner = { engine: 'mysql' as const, provision: jest.fn(), destroy: jest.fn() };
  const cipher = { encrypt: jest.fn().mockReturnValue(Buffer.from('encrypted')) };
  const service = new ManagedDatabasesService(repository as any, [provisioner], cipher as any);

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

  it('uses the logged-in email as the database username', async () => {
    repository.reserve.mockResolvedValue({ Success: true, DatabaseId: 7, InstanceId: 'instance-7', Email: 'ada@example.com' });
    provisioner.provision.mockResolvedValue({ host: 'mysql', port: 3306, username: 'ada@example.com' });
    repository.activate.mockResolvedValue(true);

    await service.create('token', { engine: 'mysql', databaseName: 'shop' });

    expect(provisioner.provision).toHaveBeenCalledWith(expect.objectContaining({ username: 'ada@example.com' }));
  });
});
