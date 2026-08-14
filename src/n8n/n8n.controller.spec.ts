import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { N8nController } from './n8n.controller';
import { N8nService } from './n8n.service';
import { UserService } from '../user/user.service';

describe('N8nController', () => {
  let controller: N8nController;
  let n8nService: { provisionAccount: jest.Mock };
  let userService: { getMe: jest.Mock };

  beforeEach(async () => {
    n8nService = { provisionAccount: jest.fn() };
    userService = { getMe: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [N8nController],
      providers: [
        { provide: N8nService, useValue: n8nService },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    controller = module.get(N8nController);
  });

  const createMockReq = (cookies: Record<string, string>): Request => ({
    cookies,
  } as unknown as Request);

  it('returns N8N credential link when user is authenticated', async () => {
    userService.getMe.mockResolvedValue({
      Success: true,
      UserId: 42,
      Name: 'Test User',
      Email: 'user@example.com',
    });
    n8nService.provisionAccount.mockResolvedValue({
      account_id: 'uuid-123',
      status: 'active',
      access_type: 'invite_link',
      credential: 'https://n8n.example.com/signup?inviterId=...&inviteeId=...',
    });

    const req = createMockReq({ session_token: 'valid-token' });

    const result = await controller.provision(req);

    expect(userService.getMe).toHaveBeenCalledWith('valid-token');
    expect(n8nService.provisionAccount).toHaveBeenCalledWith(42, 'user@example.com');
    expect(result.credential).toContain('n8n.example.com');
  });

  it('throws UnauthorizedException when session is invalid', async () => {
    userService.getMe.mockResolvedValue({ Success: false, UserId: null, Name: null, Email: null });

    const req = createMockReq({ session_token: 'invalid-token' });

    await expect(controller.provision(req)).rejects.toThrow(UnauthorizedException);
    expect(n8nService.provisionAccount).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when no session cookie', async () => {
    userService.getMe.mockResolvedValue({ Success: false, UserId: null, Name: null, Email: null });

    const req = createMockReq({});

    await expect(controller.provision(req)).rejects.toThrow(UnauthorizedException);
  });
});