import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

@Injectable()
export class DockerRunner {
  constructor(private readonly config: ConfigService) {}

  async run(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('docker', args, { windowsHide: true, timeout: 120000 });
    return stdout.trim();
  }

  async remove(name: string): Promise<void> {
    await this.run(['rm', '--force', name]).catch(() => undefined);
  }

  async waitForHealthy(name: string): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await this.run(['inspect', '--format', '{{.State.Status}}', name]).catch(() => '');
      if (status === 'running') return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Container ${name} did not start`);
  }

  async waitForCommand(name: string, command: string[]): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await this.run(['exec', name, ...command]);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error(`Container ${name} did not accept connections`);
  }

  async publishedPort(name: string, containerPort: number): Promise<number> {
    const mappings = await this.run(['port', name, `${containerPort}/tcp`]);
    const match = mappings.split(/\r?\n/).map((mapping) => mapping.match(/:(\d+)$/)).find((item) => item !== null);
    const port = match?.[1] ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Container ${name} has no published port for ${containerPort}/tcp`);
    }
    return port;
  }

  async prepareInstance(instanceId: string): Promise<void> {
    await this.runQuotaHelper('prepare', instanceId);
  }

  async applyUserDataQuota(instanceId: string): Promise<void> {
    await this.runQuotaHelper('limit', instanceId);
  }

  async cleanupInstance(instanceId: string): Promise<void> {
    await this.runQuotaHelper('cleanup', instanceId);
  }

  private async runQuotaHelper(operation: 'prepare' | 'limit' | 'cleanup', instanceId: string): Promise<void> {
    const dataRoot = this.config.get<string>('MANAGED_DATABASE_DATA_ROOT', '/srv/big-o/instances');
    const helperImage = this.config.get<string>('MANAGED_DATABASE_QUOTA_HELPER_IMAGE', 'big-o-managed-quota-helper:latest');
    await this.run([
      'run', '--rm', '--privileged',
      '--mount', `type=bind,src=${dataRoot},dst=${dataRoot}`,
      '--mount', 'type=bind,src=/etc/projects,dst=/etc/projects',
      '--mount', 'type=bind,src=/etc/projid,dst=/etc/projid',
      '--env', `MANAGED_DATABASE_DATA_ROOT=${dataRoot}`,
      helperImage, operation, instanceId,
    ]);
  }
}
