import { ManagedDatabasesController } from './managed-databases.controller';

describe('ManagedDatabasesController', () => {
  it('returns the engines enabled for managed-database provisioning', () => {
    const service = { capabilities: jest.fn().mockReturnValue({ engines: ['mysql', 'postgresql'], maxPerUser: 3 }) };
    const controller = new ManagedDatabasesController(service as any);

    expect((controller as any).capabilities()).toEqual({ engines: ['mysql', 'postgresql'], maxPerUser: 3 });
  });

  it('passes the logged-in session and requested id to the deletion service', () => {
    const service = { remove: jest.fn().mockResolvedValue({ databaseId: 9, deleted: true }) };
    const controller = new ManagedDatabasesController(service as any);
    const req = { cookies: { session_token: 'session-token' } } as any;

    expect((controller as any).remove(req, 9)).resolves.toEqual({ databaseId: 9, deleted: true });
    expect(service.remove).toHaveBeenCalledWith('session-token', 9);
  });
});
