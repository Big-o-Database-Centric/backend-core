import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { StatsModule } from './stats/stats.module';
import { UserModule } from './user/user.module';
import { ManagedDatabasesModule } from './managed-databases/managed-databases.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    StatsModule,
    UserModule,
    ManagedDatabasesModule,
  ],
})
export class AppModule {}
