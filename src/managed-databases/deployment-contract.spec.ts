import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('managed database deployment contract', () => {
  it('uses a dedicated encryption secret rather than the authentication secret', () => {
    const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/deploy.yml'), 'utf8');

    expect(workflow).toContain('DATABASE_CREDENTIALS_KEY="${{ secrets.DATABASE_CREDENTIALS_KEY }}"');
    expect(workflow).not.toContain('DATABASE_CREDENTIALS_KEY="${{ secrets.AUTH_SECRET }}"');
    expect(workflow).toContain('MANAGED_DATABASE_ENABLED_ENGINES="${{ vars.MANAGED_DATABASE_ENABLED_ENGINES || \'mysql,postgresql\' }}"');
    expect(workflow).toContain('MANAGED_DATABASE_MAX_TOTAL="${{ vars.MANAGED_DATABASE_MAX_TOTAL || \'4\' }}"');
    expect(workflow).toContain('docker inspect backend-core-previous');
    expect(workflow).toContain('docker rename backend-core-previous backend-core');
  });
});
