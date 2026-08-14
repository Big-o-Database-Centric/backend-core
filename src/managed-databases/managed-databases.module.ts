import { Module } from '@nestjs/common';
import { CredentialCipherService } from './credential-cipher.service';
import { MANAGED_DATABASE_REPOSITORY } from './managed-database.repository';
import { ManagedDatabasesController } from './managed-databases.controller';
import { ManagedDatabasesService } from './managed-databases.service';
import { ProvisionersModule } from './provisioners/provisioners.module';
import { SqlServerManagedDatabaseRepository } from './sql-server-managed-database.repository';

@Module({
  imports: [ProvisionersModule],
  controllers: [ManagedDatabasesController],
  providers: [
    CredentialCipherService,
    ManagedDatabasesService,
    { provide: MANAGED_DATABASE_REPOSITORY, useClass: SqlServerManagedDatabaseRepository },
  ],
})
export class ManagedDatabasesModule {}
