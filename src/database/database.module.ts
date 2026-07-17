import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as sql from 'mssql';
import { SqlService } from './sql.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'MSSQL_POOL',
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<sql.ConnectionPool> => {
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
        return pool.connect();
      },
    },
    SqlService,
  ],
  exports: [SqlService],
})
export class DatabaseModule {}
