import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('managed database SQL migration', () => {
  it('reserves only when fewer than three rows are pending or active', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../scripts/sql/003-managed-databases.sql'),
      'utf8',
    );

    expect(migration).toContain("State IN ('pending', 'active')");
    expect(migration).toContain('>= 3');
    expect(migration).toContain('sp_ReserveManagedDatabase');
  });
});
