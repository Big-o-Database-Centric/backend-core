import { GoogleStrategy } from './google.strategy';
import { ConfigService } from '@nestjs/config';
import type { Profile } from 'passport-google-oauth20';

function config(): ConfigService {
  return {
    getOrThrow: (k: string) => `val-${k}`,
    get: (k: string) => `val-${k}`,
  } as unknown as ConfigService;
}

const googleProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: '12345',
  displayName: 'Ada Lovelace',
  emails: [{ value: 'ada@gmail.com', verified: true }],
  _json: { email_verified: true, iss: '', azp: '', aud: '', sub: '', iat: 0, exp: 0 },
  provider: 'google',
  profileUrl: 'https://example.com',
  _raw: 'raw',
  ...overrides,
});

describe('GoogleStrategy.validate', () => {
  it('normalizes a verified Google profile to OAuthProfile', async () => {
    const strategy = new GoogleStrategy(config());
    const done = jest.fn();

    await strategy.validate('access', 'refresh', googleProfile(), done);

    expect(done).toHaveBeenCalledWith(null, {
      provider: 'google',
      providerAccountId: '12345',
      email: 'ada@gmail.com',
      name: 'Ada Lovelace',
      emailVerified: true,
    });
  });

  it('marks emailVerified false when Google says so', async () => {
    const strategy = new GoogleStrategy(config());
    const done = jest.fn();

    await strategy.validate('a', 'r', googleProfile({
      id: '1',
      displayName: 'X',
      emails: [{ value: 'x@gmail.com', verified: true }],
      _json: { email_verified: false, iss: '', aud: '', sub: '', iat: 0, exp: 0 },
    }), done);

    expect(done.mock.calls[0][1].emailVerified).toBe(false);
  });
});
