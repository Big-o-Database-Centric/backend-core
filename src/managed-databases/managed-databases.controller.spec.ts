import { ManagedDatabasesController } from './managed-databases.controller';
import { ManagedDatabasesService } from './managed-databases.service';
import type { Request } from 'express';

describe('ManagedDatabasesController', () => {
  const mockReq = (cookies: Record<string, string>): Request => ({
    cookies,
  } as unknown as Request);

  it('returns the engines enabled for managed-database provisioning', () => {
    const service = { capabilities: jest.fn().mockReturnValue({ engines: ['mysql', 'postgresql'], maxPerUser: 3 }) };
    const controller = new ManagedDatabasesController(service as unknown as ManagedDatabasesService);

    expect(controller.capabilities()).toEqual({ engines: ['mysql', 'postgresql'], maxPerUser: 3 });
  });

  it('passes the logged-in session and requested id to the deletion service', async () => {
    const service = { remove: jest.fn().mockResolvedValue({ databaseId: 9, deleted: true }) };
    const controller = new ManagedDatabasesController(service as unknown as ManagedDatabasesService);
    const req = mockReq({ session_token: 'session-token' });

    await expect(controller.remove(req, 9)).resolves.toEqual({ databaseId: 9, deleted: true });
    expect(service.remove).toHaveBeenCalledWith('session-token', 9);
  });
});
