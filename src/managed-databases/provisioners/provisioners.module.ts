import { Module } from '@nestjs/common';
import { DATABASE_PROVISIONERS, DatabaseProvisioner } from '../database-provisioner';
import { DockerRunner } from './docker-runner';
import { MongodbProvisioner } from './mongodb.provisioner';
import { MysqlProvisioner } from './mysql.provisioner';
import { PostgresqlProvisioner } from './postgresql.provisioner';
import { SqlserverProvisioner } from './sqlserver.provisioner';

@Module({
  providers: [
    DockerRunner, MysqlProvisioner, PostgresqlProvisioner, MongodbProvisioner, SqlserverProvisioner,
    { provide: DATABASE_PROVISIONERS, inject: [MysqlProvisioner, PostgresqlProvisioner, MongodbProvisioner, SqlserverProvisioner], useFactory: (...items: DatabaseProvisioner[]) => items },
  ],
  exports: [DATABASE_PROVISIONERS],
})
export class ProvisionersModule {}
