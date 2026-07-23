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

  it('fails closed when the GitHub email API call rejects', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    const strategy = new GitHubStrategy(config());
    const done = jest.fn();

    await strategy.validate('t', 'r', { id: '99', username: 'ada', displayName: 'Ada L' } as any, done);

    const arg = done.mock.calls[0][1];
    expect(arg.email).toBeNull();
    expect(arg.emailVerified).toBe(false);
    expect(arg.providerAccountId).toBe('99');
    expect(arg.provider).toBe('github');
    expect(arg.name).toBe('Ada L');
  });

  it('fails closed when the GitHub email API responds with a non-ok status', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response);
    const strategy = new GitHubStrategy(config());
    const done = jest.fn();

    await strategy.validate('t', 'r', { id: '99', username: 'ada', displayName: 'Ada L' } as any, done);

    const arg = done.mock.calls[0][1];
    expect(arg.email).toBeNull();
    expect(arg.emailVerified).toBe(false);
    expect(arg.providerAccountId).toBe('99');
    expect(arg.provider).toBe('github');
    expect(arg.name).toBe('Ada L');
  });

  it('fails closed when no email in the list is marked primary', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ email: 'x@x.com', primary: false, verified: true }],
    } as Response);
    const strategy = new GitHubStrategy(config());
    const done = jest.fn();

    await strategy.validate('t', 'r', { id: '99', username: 'ada', displayName: 'Ada L' } as any, done);

    const arg = done.mock.calls[0][1];
    expect(arg.email).toBeNull();
    expect(arg.emailVerified).toBe(false);
  });
});
