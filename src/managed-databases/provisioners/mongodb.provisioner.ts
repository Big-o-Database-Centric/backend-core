import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProvisioningInput } from '../database-provisioner';
import { BaseDockerProvisioner } from './base-docker.provisioner';
import { DockerRunner } from './docker-runner';

@Injectable()
export class MongodbProvisioner extends BaseDockerProvisioner {
  readonly engine = 'mongodb' as const;
  protected readonly image = 'mongo:8';
  protected readonly port = 27017;
  constructor(docker: DockerRunner, config: ConfigService) { super(docker, config); }
  async provision(input: ProvisioningInput) {
    const rootPassword = this.rootPassword();
    await this.start(input, [`MONGO_INITDB_ROOT_USERNAME=root`, `MONGO_INITDB_ROOT_PASSWORD=${rootPassword}`], '/data/db');
    const script = `db.getSiblingDB(${JSON.stringify(input.databaseName)}).createUser({user:${JSON.stringify(input.username)},pwd:${JSON.stringify(input.password)},roles:[{role:'readWrite',db:${JSON.stringify(input.databaseName)}}]})`;
    await this.docker.run(['exec', this.containerName(input.instanceId), 'mongosh', '--quiet', '--username', 'root', '--password', rootPassword, '--authenticationDatabase', 'admin', '--eval', script]);
    return this.connection(input);
  }
}
