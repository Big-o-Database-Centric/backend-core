import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

@Injectable()
export class DockerRunner {
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

  async prepareQuota(command: string, instanceId: string): Promise<void> {
    await execFileAsync(command, [instanceId], { windowsHide: true, timeout: 30000 });
  }
}
