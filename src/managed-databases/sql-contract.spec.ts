import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('managed database SQL migration', () => {
  it('reserves only when fewer than three rows are consuming capacity', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../scripts/sql/003-managed-databases.sql'),
      'utf8',
    );

    expect(migration).toContain("State IN ('pending', 'active', 'deleting')");
    expect(migration).toContain('>= 3');
    expect(migration).toContain('sp_ReserveManagedDatabase');
  });

  it('accepts a global capacity limit inside the reservation procedure', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../scripts/sql/003-managed-databases.sql'),
      'utf8',
    );

    expect(migration).toContain('@MaxTotal INT');
    expect(migration).toContain('Maximum managed database capacity reached');
  });

  it('reserves an owned database for cleanup before permanently removing its metadata', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../scripts/sql/003-managed-databases.sql'),
      'utf8',
    );

    expect(migration).toContain('sp_BeginDeleteManagedDatabase');
    expect(migration).toContain("State = 'deleting'");
    expect(migration).toContain('sp_CompleteDeleteManagedDatabase');
    expect(migration).toContain("DELETE FROM dbo.UserDatabases WHERE DatabaseId = @DatabaseId AND State = 'deleting'");
  });

  it('guards every managed-database column independently for fresh schemas and upgrades', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../scripts/sql/003-managed-databases.sql'),
      'utf8',
    );

    for (const column of ['InstanceId', 'HostName', 'Port', 'DatabaseUser', 'EncryptedPassword', 'QuotaBytes', 'State', 'FailureReason', 'ActivatedAt', 'DeactivatedAt']) {
      expect(migration).toContain(`COL_LENGTH('dbo.UserDatabases', '${column}') IS NULL`);
    }
  });
});
