import { Inject, Injectable } from '@nestjs/common';
import * as sql from 'mssql';

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
}
