import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProvisioningInput } from '../database-provisioner';
import { BaseDockerProvisioner } from './base-docker.provisioner';
import { DockerRunner } from './docker-runner';

@Injectable()
export class PostgresqlProvisioner extends BaseDockerProvisioner {
  readonly engine = 'postgresql' as const;
  protected readonly image = 'postgres:16';
  protected readonly port = 5432;
  constructor(docker: DockerRunner, config: ConfigService) { super(docker, config); }
  async provision(input: ProvisioningInput) {
    const port = await this.start(input, [`POSTGRES_DB=${input.databaseName}`, `POSTGRES_USER=${input.username}`, `POSTGRES_PASSWORD=${input.password}`], '/var/lib/postgresql/data');
    await this.docker.waitForCommand(this.containerName(input.instanceId), ['pg_isready', '-h', '127.0.0.1', '-U', input.username, '-d', input.databaseName]);
    await this.limitUserData(input.instanceId);
    return this.connection(input, port);
  }
}
