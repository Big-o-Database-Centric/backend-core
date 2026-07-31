import { ManagedDatabasesController } from './managed-databases.controller';

describe('ManagedDatabasesController', () => {
  it('returns the engines enabled for managed-database provisioning', () => {
    const service = { capabilities: jest.fn().mockReturnValue({ engines: ['mysql', 'postgresql'], maxPerUser: 3 }) };
    const controller = new ManagedDatabasesController(service as any);

    expect((controller as any).capabilities()).toEqual({ engines: ['mysql', 'postgresql'], maxPerUser: 3 });
  });
});
