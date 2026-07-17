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
  let authService: { register: jest.Mock; login: jest.Mock };

  beforeEach(async () => {
    authService = { register: jest.fn(), login: jest.fn() };

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

  it('logout clears the cookie', () => {
    const res = mockResponse();

    const result = controller.logout(res);

    expect(res.clearCookie).toHaveBeenCalledWith('session_token');
    expect(result).toEqual({ success: true });
  });
});
