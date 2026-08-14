import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SqlService } from './sql.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'MSSQL_POOL',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => SqlService.createPool(config),
    },
    SqlService,
  ],
  exports: [SqlService],
})
export class DatabaseModule {}
