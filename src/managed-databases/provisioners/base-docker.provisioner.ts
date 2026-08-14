import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DockerRunner } from './docker-runner';
import { DatabaseProvisioner, ProvisionedConnection, ProvisioningInput } from '../database-provisioner';
import { ManagedEngine } from '../managed-database.types';

export abstract class BaseDockerProvisioner implements DatabaseProvisioner {
  abstract readonly engine: ManagedEngine;
  protected abstract readonly image: string;
  protected abstract readonly port: number;
  abstract provision(input: ProvisioningInput): Promise<ProvisionedConnection>;

  constructor(protected readonly docker: DockerRunner, protected readonly config: ConfigService) {}

  protected containerName(instanceId: string) { return `big-o-${this.engine}-${instanceId}`; }
  protected dataPath(instanceId: string) { return `${this.config.get<string>('MANAGED_DATABASE_DATA_ROOT', '/srv/big-o/instances')}/${instanceId}`; }
  protected host() {
    const host = this.config.get<string>('MANAGED_DATABASE_HOST');
    if (!host) throw new Error('MANAGED_DATABASE_HOST must be configured');
    return host;
  }
  protected rootPassword() { return randomBytes(24).toString('base64url'); }

  protected resourceLimits(): string[] {
    return this.engine === 'mysql'
      ? ['--memory', '512m', '--cpus', '0.5']
      : ['--memory', '256m', '--cpus', '0.5'];
  }

  protected async start(input: ProvisioningInput, environment: string[], targetPath: string): Promise<number> {
    this.host();
    const name = this.containerName(input.instanceId);
    await this.docker.prepareInstance(input.instanceId);
    await this.docker.run(['network', 'inspect', 'big-o-private']).catch(() => this.docker.run(['network', 'create', 'big-o-private']));
    await this.docker.run(['run', '--detach', '--name', name, '--network', 'big-o-private', '--publish', String(this.port), '--mount', `type=bind,src=${this.dataPath(input.instanceId)},dst=${targetPath}`, ...this.resourceLimits(), ...environment.flatMap((value) => ['--env', value]), this.image]);
    await this.docker.waitForHealthy(name);
    return this.docker.publishedPort(name, this.port);
  }

  async destroy(instanceId: string): Promise<void> {
    await this.docker.remove(this.containerName(instanceId));
    await this.docker.cleanupInstance(instanceId);
  }

  protected async limitUserData(instanceId: string): Promise<void> {
    await this.docker.applyUserDataQuota(instanceId);
  }

  protected connection(input: ProvisioningInput, port: number): ProvisionedConnection {
    return { host: this.host(), port, username: input.username };
  }
}
