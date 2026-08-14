import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';
import { SqlService } from '../database/sql.service';
import { ManagedDatabaseRepository } from './managed-database.repository';
import { DeleteReservationResult, ManagedDatabaseRecord, ManagedEngine, ReservationResult } from './managed-database.types';

@Injectable()
export class SqlServerManagedDatabaseRepository implements ManagedDatabaseRepository {
  constructor(private readonly sql: SqlService, private readonly config: ConfigService) {}

  async reserve(sessionToken: string | null, databaseName: string, engine: ManagedEngine): Promise<ReservationResult> {
    const [row] = await this.sql.execute<ReservationResult>('sp_ReserveManagedDatabase', {
      SessionToken: { type: sql.UniqueIdentifier, value: sessionToken },
      DatabaseName: { type: sql.NVarChar(100), value: databaseName },
      Engine: { type: sql.NVarChar(50), value: engine },
      MaxTotal: { type: sql.Int, value: this.maxTotal() },
    });
    return row;
  }

  async activate(databaseId: number, connection: { host: string; port: number; username: string }, encryptedPassword: Buffer): Promise<boolean> {
    const [row] = await this.sql.execute<{ Success: boolean }>('sp_ActivateManagedDatabase', {
      DatabaseId: { type: sql.Int, value: databaseId },
      HostName: { type: sql.NVarChar(255), value: connection.host },
      Port: { type: sql.Int, value: connection.port },
      DatabaseUser: { type: sql.NVarChar(128), value: connection.username },
      EncryptedPassword: { type: sql.VarBinary(sql.MAX), value: encryptedPassword },
    });
    return row?.Success === true;
  }

  async fail(databaseId: number, reason: string): Promise<void> {
    await this.sql.execute('sp_FailManagedDatabase', {
      DatabaseId: { type: sql.Int, value: databaseId },
      FailureReason: { type: sql.NVarChar(250), value: reason.slice(0, 250) },
    });
  }

  async list(sessionToken: string | null): Promise<ManagedDatabaseRecord[]> {
    return this.sql.execute<ManagedDatabaseRecord>('sp_GetManagedDatabases', {
      SessionToken: { type: sql.UniqueIdentifier, value: sessionToken },
    });
  }

  async beginDelete(sessionToken: string | null, databaseId: number): Promise<DeleteReservationResult> {
    const [row] = await this.sql.execute<DeleteReservationResult>('sp_BeginDeleteManagedDatabase', {
      SessionToken: { type: sql.UniqueIdentifier, value: sessionToken },
      DatabaseId: { type: sql.Int, value: databaseId },
    });
    return row;
  }

  async completeDelete(databaseId: number): Promise<boolean> {
    const [row] = await this.sql.execute<{ Success: boolean }>('sp_CompleteDeleteManagedDatabase', {
      DatabaseId: { type: sql.Int, value: databaseId },
    });
    return row?.Success === true;
  }

  async failDelete(databaseId: number, reason: string): Promise<void> {
    await this.sql.execute('sp_FailManagedDatabaseDeletion', {
      DatabaseId: { type: sql.Int, value: databaseId },
      FailureReason: { type: sql.NVarChar(250), value: reason.slice(0, 250) },
    });
  }

  private maxTotal(): number {
    const configured = Number(this.config.get<string>('MANAGED_DATABASE_MAX_TOTAL', '4'));
    return Number.isSafeInteger(configured) && configured > 0 ? configured : 4;
  }
}
