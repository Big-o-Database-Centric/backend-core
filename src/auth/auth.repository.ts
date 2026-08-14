import * as sql from 'mssql';
import { Inject, Injectable } from "@nestjs/common";
import { IAuthRepository } from "./interfaces/auth.repository.interface";
import { RegisterDto } from "./dto/register.dto";
import { DatabaseConnection } from "src/database/database.connection";
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthRepository implements IAuthRepository {
    // Is inyected in this way because isn't a nest dependency.
    private readonly pool: Promise<sql.ConnectionPool>;

    constructor() {
        this.pool = DatabaseConnection.getConnection();
    }

    async register(dto: RegisterDto): Promise<any> {
        const pool = await this.pool;

        const result = await pool
            .request()
            .input('FullName', sql.NVarChar, dto.fullname) // Params needed
            .input('Email', sql.NVarChar, dto.email)
            .input('Password', sql.NVarChar, dto.password)
            .execute('usp_Register'); // Calling stored procedure
        
        return result.recordset[0];
    }

    async login(dto: LoginDto): Promise<any> {
        const pool = await this.pool;

        const result = await pool
            .request()
            .input('Email', sql.NVarChar, dto.email)
            .input('Password', sql.NVarChar, dto.password)
            .execute('usp_Login');

        return result.recordset[0];
    }
}