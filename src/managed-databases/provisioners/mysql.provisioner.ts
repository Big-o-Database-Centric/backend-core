import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProvisioningInput } from '../database-provisioner';
import { BaseDockerProvisioner } from './base-docker.provisioner';
import { DockerRunner } from './docker-runner';

@Injectable()
export class MysqlProvisioner extends BaseDockerProvisioner {
  readonly engine = 'mysql' as const;
  protected readonly image = 'mysql:8.4';
  protected readonly port = 3306;
  constructor(docker: DockerRunner, config: ConfigService) { super(docker, config); }
  async provision(input: ProvisioningInput) {
    await this.start(input, [`MYSQL_ROOT_PASSWORD=${this.rootPassword()}`, `MYSQL_DATABASE=${input.databaseName}`, `MYSQL_USER=${input.username}`, `MYSQL_PASSWORD=${input.password}`], '/var/lib/mysql');
    return this.connection(input);
  }
}
