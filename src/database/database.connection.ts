import * as sql from 'mssql';
import { ConfigModule } from '@nestjs/config';

export class DatabaseConnection {
    static async getConnection() {
        const config: sql.config = {
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                server: process.env.DB_HOST || 'localhost',
                database: process.env.DB_NAME,
                port: Number(process.env.DB_PORT) || 1433,
                options: {
                    encrypt: false,
                    trustServerCertificate: true
                }
            };

        return await sql.connect(config);
    }
}