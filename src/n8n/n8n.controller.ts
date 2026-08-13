import { Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { N8nService, ProvisionN8nResponse } from './n8n.service';
import { UserService } from '../user/user.service';

@Controller('api/n8n')
export class N8nController {
  constructor(
    private readonly n8nService: N8nService,
    private readonly userService: UserService,
  ) {}

  @Post('provision')
  async provision(@Req() req: Request): Promise<ProvisionN8nResponse> {
    const token = req.cookies?.session_token ?? null;

    const userInfo = await this.userService.getMe(token);
    if (!userInfo?.Success || !userInfo.UserId || !userInfo.Email) {
      throw new UnauthorizedException();
    }

    return this.n8nService.provisionAccount(userInfo.UserId, userInfo.Email);
  }
}