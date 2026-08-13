import { CredentialCipherService } from './credential-cipher.service';
import { ConfigService } from '@nestjs/config';

describe('CredentialCipherService', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  const mockConfig = (): ConfigService => ({
    getOrThrow: jest.fn().mockReturnValue(key),
    get: jest.fn(),
  } as unknown as ConfigService);

  it('round-trips a secret without retaining plaintext bytes', () => {
    const cipher = new CredentialCipherService(mockConfig());
    const encrypted = cipher.encrypt('secret-value');

    expect(encrypted.toString('utf8')).not.toContain('secret-value');
    expect(cipher.decrypt(encrypted)).toBe('secret-value');
  });
});
