import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { SqlService } from '../database/sql.service';

export interface UserInfoResult {
  Success: boolean;
  UserId: number | null;
  Name: string | null;
  Email: string | null;
}

export interface UserDatabaseRow {
  Success?: boolean;
  DatabaseId?: number;
  DatabaseName?: string;
  Engine?: string;
  CreatedAt?: string;
}

@Injectable()
export class UserService {
  constructor(private readonly sqlService: SqlService) {}

  async getMe(sessionToken: string | null): Promise<UserInfoResult> {
    const [row] = await this.sqlService.execute<UserInfoResult>('sp_GetUserInfo', {
      SessionToken: { type: sql.UniqueIdentifier, value: sessionToken },
    });
    return row;
  }

  async getMyDatabases(sessionToken: string | null): Promise<UserDatabaseRow[]> {
    return this.sqlService.execute<UserDatabaseRow>('sp_GetUserDatabases', {
      SessionToken: { type: sql.UniqueIdentifier, value: sessionToken },
    });
  }
}
