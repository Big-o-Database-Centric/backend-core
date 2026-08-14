import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('managed database quota helper image', () => {
  it('makes its entrypoint executable before Docker starts the helper', () => {
    const dockerfile = readFileSync(resolve(__dirname, '../../infra/managed-databases/Dockerfile.quota-helper'), 'utf8');

    expect(dockerfile).toContain('RUN chmod +x /usr/local/bin/prepare-quotas');
  });

  it('installs the Alpine package that provides xfs_quota', () => {
    const dockerfile = readFileSync(resolve(__dirname, '../../infra/managed-databases/Dockerfile.quota-helper'), 'utf8');

    expect(dockerfile).toContain('xfsprogs-extra');
  });
});
