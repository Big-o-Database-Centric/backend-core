import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { SqlService } from '../database/sql.service';
import { OAuthProfile } from './oauth/oauth-profile.interface';

describe('AuthService', () => {
  let service: AuthService;
  let sqlService: { execute: jest.Mock };

  beforeEach(async () => {
    sqlService = { execute: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService, { provide: SqlService, useValue: sqlService }],
    }).compile();

    service = module.get(AuthService);
  });

  it('calls sp_Register with Name/Email/Password and returns the first row', async () => {
    sqlService.execute.mockResolvedValue([{ Success: true, Message: 'Registered', UserId: 1 }]);

    const result = await service.register('Ada', 'ada@example.com', 'secret');

    expect(sqlService.execute).toHaveBeenCalledWith(
      'sp_Register',
      expect.objectContaining({
        Name: expect.objectContaining({ value: 'Ada' }),
        Email: expect.objectContaining({ value: 'ada@example.com' }),
        Password: expect.objectContaining({ value: 'secret' }),
      }),
    );
    expect(result).toEqual({ Success: true, Message: 'Registered', UserId: 1 });
  });

  it('calls sp_Login with Email/Password and returns the first row', async () => {
    sqlService.execute.mockResolvedValue([
      { Success: true, Message: 'OK', UserId: 1, SessionToken: 'tok', Name: 'Ada', Email: 'ada@example.com' },
    ]);

    const result = await service.login('ada@example.com', 'secret');

    expect(sqlService.execute).toHaveBeenCalledWith(
      'sp_Login',
      expect.objectContaining({
        Email: expect.objectContaining({ value: 'ada@example.com' }),
        Password: expect.objectContaining({ value: 'secret' }),
      }),
    );
    expect(result.SessionToken).toBe('tok');
  });

  it('calls sp_Logout with the session token', async () => {
    sqlService.execute.mockResolvedValue([{ Success: true }]);

    await service.logout('tok-123');

    expect(sqlService.execute).toHaveBeenCalledWith(
      'sp_Logout',
      expect.objectContaining({ SessionToken: expect.objectContaining({ value: 'tok-123' }) }),
    );
  });

  it('logout does not call the SP when token is null', async () => {
    await service.logout(null);
    expect(sqlService.execute).not.toHaveBeenCalled();
  });

  it('calls sp_OAuthLogin with the normalized profile', async () => {
    sqlService.execute.mockResolvedValue([
      { Success: true, Message: 'OK', UserId: 5, SessionToken: 'tok', Name: 'Ada', Email: 'ada@x.com' },
    ]);
    const profile: OAuthProfile = {
      provider: 'google', providerAccountId: 'g-1', email: 'ada@x.com', name: 'Ada', emailVerified: true,
    };

    const result = await service.oauthLogin(profile);

    expect(sqlService.execute).toHaveBeenCalledWith(
      'sp_OAuthLogin',
      expect.objectContaining({
        Provider: expect.objectContaining({ value: 'google' }),
        ProviderAccountId: expect.objectContaining({ value: 'g-1' }),
        Email: expect.objectContaining({ value: 'ada@x.com' }),
        Name: expect.objectContaining({ value: 'Ada' }),
        EmailVerified: expect.objectContaining({ value: true }),
      }),
    );
    expect(result.SessionToken).toBe('tok');
  });
});
