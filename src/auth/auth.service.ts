import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { SqlService } from '../database/sql.service';

export interface RegisterResult {
  Success: boolean;
  Message: string;
  UserId: number | null;
}

export interface LoginResult {
  Success: boolean;
  Message: string;
  UserId: number | null;
  SessionToken: string | null;
  Name: string | null;
  Email: string | null;
}

@Injectable()
export class AuthService {
  constructor(private readonly sqlService: SqlService) {}

  async register(name: string, email: string, password: string): Promise<RegisterResult> {
    const [row] = await this.sqlService.execute<RegisterResult>('sp_Register', {
      Name: { type: sql.NVarChar, value: name },
      Email: { type: sql.NVarChar, value: email },
      Password: { type: sql.NVarChar, value: password },
    });
    return row;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const [row] = await this.sqlService.execute<LoginResult>('sp_Login', {
      Email: { type: sql.NVarChar, value: email },
      Password: { type: sql.NVarChar, value: password },
    });
    return row;
  }
}
