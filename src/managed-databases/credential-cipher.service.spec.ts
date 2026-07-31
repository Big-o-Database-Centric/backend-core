import { CredentialCipherService } from './credential-cipher.service';

describe('CredentialCipherService', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('round-trips a secret without retaining plaintext bytes', () => {
    const cipher = new CredentialCipherService({ getOrThrow: jest.fn().mockReturnValue(key) } as any);
    const encrypted = cipher.encrypt('secret-value');

    expect(encrypted.toString('utf8')).not.toContain('secret-value');
    expect(cipher.decrypt(encrypted)).toBe('secret-value');
  });
});
