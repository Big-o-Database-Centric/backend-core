import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { StatsModule } from './stats/stats.module';
import { UserModule } from './user/user.module';
import { ManagedDatabasesModule } from './managed-databases/managed-databases.module';
import { AiModule } from './ai/ai.module';
import { N8nModule } from './n8n/n8n.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    StatsModule,
    UserModule,
    ManagedDatabasesModule,
    AiModule,
    N8nModule,
  ],
})
export class AppModule {}
