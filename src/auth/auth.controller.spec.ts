import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

function mockResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as import('express').Response;
}

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { register: jest.Mock; login: jest.Mock; logout: jest.Mock; oauthLogin: jest.Mock };

  beforeEach(async () => {
    authService = { register: jest.fn(), login: jest.fn(), logout: jest.fn(), oauthLogin: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get(AuthController);
  });

  it('register returns the SP row as-is, even when Success is false', async () => {
    authService.register.mockResolvedValue({ Success: false, Message: 'Email already registered', UserId: null });

    const result = await controller.register({ name: 'Ada', email: 'ada@example.com', password: 'x' });

    expect(result).toEqual({ Success: false, Message: 'Email already registered', UserId: null });
  });

  it('login sets the session cookie and returns the row when Success is true', async () => {
    authService.login.mockResolvedValue({
      Success: true, Message: 'OK', UserId: 1, SessionToken: 'tok', Name: 'Ada', Email: 'ada@example.com',
    });
    const res = mockResponse();

    const result = await controller.login({ email: 'ada@example.com', password: 'x' }, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'session_token',
      'tok',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax' }),
    );
    expect(result.UserId).toBe(1);
  });

  it('login throws Unauthorized when Success is false', async () => {
    authService.login.mockResolvedValue({
      Success: false, Message: 'Invalid credentials', UserId: null, SessionToken: null, Name: null, Email: null,
    });
    const res = mockResponse();

    await expect(controller.login({ email: 'ada@example.com', password: 'wrong' }, res)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('logout invalidates the session and clears the cookie', async () => {
    authService.logout = jest.fn().mockResolvedValue(undefined);
    const res = mockResponse();
    const req = { cookies: { session_token: 'tok-123' } } as unknown as import('express').Request;

    const result = await controller.logout(req, res);

    expect(authService.logout).toHaveBeenCalledWith('tok-123');
    expect(res.clearCookie).toHaveBeenCalledWith('session_token');
    expect(result).toEqual({ success: true });
  });
});

function redirectResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
  } as unknown as import('express').Response;
}

describe('AuthController OAuth callback', () => {
  let controller: AuthController;
  let authService: { register: jest.Mock; login: jest.Mock; logout: jest.Mock; oauthLogin: jest.Mock };

  beforeEach(async () => {
    authService = { register: jest.fn(), login: jest.fn(), logout: jest.fn(), oauthLogin: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    controller = module.get(AuthController);
  });

  it('sets the cookie and redirects to the dashboard on success', async () => {
    authService.oauthLogin.mockResolvedValue({
      Success: true, Message: 'OK', UserId: 1, SessionToken: 'tok', Name: 'A', Email: 'a@x.com',
    });
    const res = redirectResponse();
    const req = { user: { provider: 'google', providerAccountId: 'g1', email: 'a@x.com', name: 'A', emailVerified: true } } as any;

    await controller.googleCallback(req, res);

    expect(res.cookie).toHaveBeenCalledWith('session_token', 'tok', expect.objectContaining({ httpOnly: true }));
    expect(res.redirect).toHaveBeenCalledWith('/views/dashboard.html');
  });

  it('redirects to login with an error when the SP rejects', async () => {
    authService.oauthLogin.mockResolvedValue({
      Success: false, Message: 'Email no verificado por el proveedor', UserId: null, SessionToken: null, Name: null, Email: null,
    });
    const res = redirectResponse();
    const req = { user: { provider: 'github', providerAccountId: 'h1', email: null, name: 'A', emailVerified: false } } as any;

    await controller.githubCallback(req, res);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/views/login.html?error=oauth_email_not_verified');
  });
});
