import { DeleteReservationResult, ManagedDatabaseRecord, ManagedEngine, ReservationResult } from './managed-database.types';

export const MANAGED_DATABASE_REPOSITORY = Symbol('MANAGED_DATABASE_REPOSITORY');

export interface ManagedDatabaseRepository {
  reserve(sessionToken: string | null, databaseName: string, engine: ManagedEngine): Promise<ReservationResult>;
  activate(databaseId: number, connection: { host: string; port: number; username: string }, encryptedPassword: Buffer): Promise<boolean>;
  fail(databaseId: number, reason: string): Promise<void>;
  beginDelete(sessionToken: string | null, databaseId: number): Promise<DeleteReservationResult>;
  completeDelete(databaseId: number): Promise<boolean>;
  failDelete(databaseId: number, reason: string): Promise<void>;
  list(sessionToken: string | null): Promise<ManagedDatabaseRecord[]>;
}
