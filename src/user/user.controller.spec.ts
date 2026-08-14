import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';

function requestWithCookie(token?: string) {
  return { cookies: token ? { session_token: token } : {} } as unknown as import('express').Request;
}

describe('UserController', () => {
  let controller: UserController;
  let userService: { getMe: jest.Mock; getMyDatabases: jest.Mock };

  beforeEach(async () => {
    userService = { getMe: jest.fn(), getMyDatabases: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: userService }],
    }).compile();

    controller = module.get(UserController);
  });

  it('GET /api/me passes the cookie value through and returns it on success', async () => {
    userService.getMe.mockResolvedValue({ Success: true, UserId: 1, Name: 'Ada', Email: 'ada@example.com' });

    const result = await controller.getMe(requestWithCookie('tok'));

    expect(userService.getMe).toHaveBeenCalledWith('tok');
    expect(result.UserId).toBe(1);
  });

  it('GET /api/me passes null when there is no cookie', async () => {
    userService.getMe.mockResolvedValue({ Success: false, UserId: null, Name: null, Email: null });

    await expect(controller.getMe(requestWithCookie())).rejects.toThrow(UnauthorizedException);

    expect(userService.getMe).toHaveBeenCalledWith(null);
  });

  it('GET /api/my-databases returns the row list on success', async () => {
    const rows = [{ DatabaseId: 1, DatabaseName: 'shop', Engine: 'mysql', CreatedAt: '2026-01-01' }];
    userService.getMyDatabases.mockResolvedValue(rows);

    const result = await controller.getMyDatabases(requestWithCookie('tok'));

    expect(result).toEqual(rows);
  });

  it('GET /api/my-databases throws Unauthorized when the SP reports Success=false', async () => {
    userService.getMyDatabases.mockResolvedValue([{ Success: false }]);

    await expect(controller.getMyDatabases(requestWithCookie())).rejects.toThrow(UnauthorizedException);
  });
});
