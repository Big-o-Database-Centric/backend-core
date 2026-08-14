import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('AI usage SQL migration', () => {
  const migration = readFileSync(resolve(__dirname, '../../scripts/sql/004-ai-usage.sql'), 'utf8');

  it('creates an additive metadata-only request table', () => {
    expect(migration).toContain("OBJECT_ID('dbo.AiRequests', 'U') IS NULL");
    expect(migration).toContain('CREATE TABLE dbo.AiRequests');
    expect(migration).not.toMatch(/\b(?:Prompt|PromptContent|ResponseContent|MessageContent)\b/);
  });

  it('reserves quota atomically for authenticated sessions', () => {
    expect(migration).toContain('sp_ReserveAiRequest');
    expect(migration).toContain('sp_getapplock');
    expect(migration).toContain("N'ai-shared-quota'");
    expect(migration).toContain('SYSUTCDATETIME()');
  });

  it('provides completion and capabilities procedures', () => {
    expect(migration).toContain('sp_CompleteAiRequest');
    expect(migration).toContain('sp_GetAiCapabilities');
  });
});
