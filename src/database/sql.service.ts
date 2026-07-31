import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SqlParam {
  type: unknown;
  value: unknown;
}

@Injectable()
export class SqlService {
  constructor(@Inject('MSSQL_POOL') private readonly pool: sql.ConnectionPool) {}

  async execute<T = Record<string, unknown>>(
    spName: string,
    params: Record<string, SqlParam> = {},
  ): Promise<T[]> {
    const request = this.pool.request();

    for (const [name, { type, value }] of Object.entries(params)) {
      request.input(name, type as sql.ISqlType, value);
    }

    const result = await request.execute(spName);
    return (result.recordset ?? []) as T[];
  }

  static async createPool(config: ConfigService): Promise<sql.ConnectionPool> {
    const pool = new sql.ConnectionPool({
      server: config.getOrThrow<string>('SQL_SERVER'),
      database: config.getOrThrow<string>('SQL_DATABASE'),
      user: config.getOrThrow<string>('SQL_USER'),
      password: config.getOrThrow<string>('SQL_PASSWORD'),
      port: Number(config.get('SQL_PORT', '1433')),
      options: {
        encrypt: config.get('SQL_SERVER_ENCRYPT', 'true') === 'true',
        trustServerCertificate:
          config.get('SQL_SERVER_TRUST_SERVER_CERT', 'false') === 'true',
      },
    });
    const connected = await pool.connect();
    if (typeof (pool as unknown as { request?: unknown }).request === 'function') {
      await this.applyManagedDatabaseMigration(pool);
    }
    return connected;
  }

  private static async applyManagedDatabaseMigration(pool: sql.ConnectionPool): Promise<void> {
    const migration = readFileSync(resolve(process.cwd(), 'scripts/sql/003-managed-databases.sql'), 'utf8');
    const batches = migration.split(/^\s*GO\s*$/gim).map((batch) => batch.trim()).filter(Boolean);
    for (const batch of batches) await pool.request().batch(batch);
  }
}
