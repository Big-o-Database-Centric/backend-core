import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('base SQL schema', () => {
  it('terminates the statement immediately before THROW', () => {
    const schema = readFileSync(resolve(__dirname, '../../scripts/sql/schema.sql'), 'utf8');
    expect(schema).toMatch(/END;\s*THROW;/);
  });
});
