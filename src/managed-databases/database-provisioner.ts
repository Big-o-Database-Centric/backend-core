import { ManagedEngine } from './managed-database.types';

export const DATABASE_PROVISIONERS = Symbol('DATABASE_PROVISIONERS');

export interface ProvisioningInput {
  instanceId: string;
  databaseName: string;
  username: string;
  password: string;
}

export interface ProvisionedConnection {
  host: string;
  port: number;
  username: string;
}

export interface DatabaseProvisioner {
  readonly engine: ManagedEngine;
  provision(input: ProvisioningInput): Promise<ProvisionedConnection>;
  destroy(instanceId: string): Promise<void>;
}
