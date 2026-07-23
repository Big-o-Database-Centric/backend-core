import { GoogleStrategy } from './google.strategy';
import { ConfigService } from '@nestjs/config';

function config(): ConfigService {
  return {
    getOrThrow: (k: string) => `val-${k}`,
    get: (k: string) => `val-${k}`,
  } as unknown as ConfigService;
}

describe('GoogleStrategy.validate', () => {
  it('normalizes a verified Google profile to OAuthProfile', async () => {
    const strategy = new GoogleStrategy(config());
    const done = jest.fn();

    await strategy.validate('access', 'refresh', {
      id: '12345',
      displayName: 'Ada Lovelace',
      emails: [{ value: 'ada@gmail.com' }],
      _json: { email_verified: true },
    } as any, done);

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

    await strategy.validate('a', 'r', {
      id: '1', displayName: 'X', emails: [{ value: 'x@gmail.com' }],
      _json: { email_verified: false },
    } as any, done);

    expect(done.mock.calls[0][1].emailVerified).toBe(false);
  });
});
