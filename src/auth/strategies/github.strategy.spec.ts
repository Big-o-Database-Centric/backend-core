import { GitHubStrategy } from './github.strategy';
import { ConfigService } from '@nestjs/config';

function config(): ConfigService {
  return { getOrThrow: (k: string) => `val-${k}`, get: (k: string) => `val-${k}` } as unknown as ConfigService;
}

describe('GitHubStrategy.validate', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolves the primary verified email from the GitHub API', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { email: 'secondary@x.com', primary: false, verified: true },
        { email: 'ada@github.com', primary: true, verified: true },
      ],
    } as Response);

    const strategy = new GitHubStrategy(config());
    const done = jest.fn();

    await strategy.validate('access-token', 'refresh', {
      id: '99', username: 'ada', displayName: 'Ada L',
    } as any, done);

    expect(done).toHaveBeenCalledWith(null, {
      provider: 'github',
      providerAccountId: '99',
      email: 'ada@github.com',
      name: 'Ada L',
      emailVerified: true,
    });
  });

  it('reports emailVerified false when the primary email is unverified', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ email: 'ada@github.com', primary: true, verified: false }],
    } as Response);

    const strategy = new GitHubStrategy(config());
    const done = jest.fn();

    await strategy.validate('t', 'r', { id: '99', username: 'ada', displayName: 'Ada L' } as any, done);

    const arg = done.mock.calls[0][1];
    expect(arg.emailVerified).toBe(false);
  });

  it('falls back to username when displayName is missing', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: async () => [{ email: 'a@b.com', primary: true, verified: true }],
    } as Response);

    const strategy = new GitHubStrategy(config());
    const done = jest.fn();

    await strategy.validate('t', 'r', { id: '1', username: 'ada', displayName: null } as any, done);

    expect(done.mock.calls[0][1].name).toBe('ada');
  });
});
