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
    const port = await this.start(input, [`MYSQL_ROOT_PASSWORD=${this.rootPassword()}`, `MYSQL_DATABASE=${input.databaseName}`, `MYSQL_USER=${input.username}`, `MYSQL_PASSWORD=${input.password}`], '/var/lib/mysql');
    await this.docker.waitForCommand(this.containerName(input.instanceId), ['mysqladmin', 'ping', '-h', '127.0.0.1', `-u${input.username}`, `-p${input.password}`]);
    await this.limitUserData(input.instanceId);
    return this.connection(input, port);
  }
}
