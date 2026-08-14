import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const extractStartBackend = (workflow: string) => {
  const match = workflow.match(/^\s*start_backend\(\) \{[\s\S]*?^\s*\}/m);
  if (!match) throw new Error('start_backend function not found');
  return match[0];
};

describe('managed database deployment contract', () => {
  it('uses a dedicated encryption secret rather than the authentication secret', () => {
    const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/deploy.yml'), 'utf8');

    expect(workflow).toContain('DATABASE_CREDENTIALS_KEY="${{ secrets.DATABASE_CREDENTIALS_KEY }}"');
    expect(workflow).not.toContain('DATABASE_CREDENTIALS_KEY="${{ secrets.AUTH_SECRET }}"');
    expect(workflow).toContain('MANAGED_DATABASE_ENABLED_ENGINES="${{ vars.MANAGED_DATABASE_ENABLED_ENGINES || \'mysql,postgresql\' }}"');
    expect(workflow).toContain('MANAGED_DATABASE_MAX_TOTAL="${{ vars.MANAGED_DATABASE_MAX_TOTAL || \'4\' }}"');
    expect(workflow).toContain('docker inspect backend-core-previous');
    expect(workflow).toContain('docker rename backend-core-previous backend-core');
    const startBackend = extractStartBackend(workflow);
    const startBackendLines = startBackend.split(/\r?\n/).map((line) => line.trim());
    expect(startBackendLines).toEqual(expect.arrayContaining([
      '-e POLYSERVICE_AI_KEY="${{ secrets.POLYSERVICE_AI_KEY }}" \\',
      '-e AI_USER_PER_MINUTE="${{ vars.AI_USER_PER_MINUTE || \'3\' }}" \\',
      '-e AI_USER_PER_DAY="${{ vars.AI_USER_PER_DAY || \'10\' }}" \\',
      '-e AI_GLOBAL_PER_MINUTE="${{ vars.AI_GLOBAL_PER_MINUTE || \'9\' }}" \\',
      '-e AI_GLOBAL_PER_DAY="${{ vars.AI_GLOBAL_PER_DAY || \'90\' }}" \\',
    ]));
  });
});
