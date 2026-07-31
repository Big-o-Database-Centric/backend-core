import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProvisioningInput } from '../database-provisioner';
import { BaseDockerProvisioner } from './base-docker.provisioner';
import { DockerRunner } from './docker-runner';

@Injectable()
export class SqlserverProvisioner extends BaseDockerProvisioner {
  readonly engine = 'sqlserver' as const;
  protected readonly image = 'mcr.microsoft.com/mssql/server:2022-latest';
  protected readonly port = 1433;
  constructor(docker: DockerRunner, config: ConfigService) { super(docker, config); }
  async provision(input: ProvisioningInput) {
    const saPassword = `Aa1!${this.rootPassword()}`;
    await this.start(input, ['ACCEPT_EULA=Y', `MSSQL_SA_PASSWORD=${saPassword}`], '/var/opt/mssql');
    const quote = (value: string) => value.replace(/]/g, ']]');
    const literal = (value: string) => value.replace(/'/g, "''");
    const command = `CREATE DATABASE [${quote(input.databaseName)}]; CREATE LOGIN [${quote(input.username)}] WITH PASSWORD='${literal(input.password)}'; USE [${quote(input.databaseName)}]; CREATE USER [${quote(input.username)}] FOR LOGIN [${quote(input.username)}]; ALTER ROLE db_owner ADD MEMBER [${quote(input.username)}];`;
    await this.docker.run(['exec', this.containerName(input.instanceId), '/opt/mssql-tools18/bin/sqlcmd', '-C', '-S', 'localhost', '-U', 'sa', '-P', saPassword, '-Q', command]);
    return this.connection(input);
  }
}
