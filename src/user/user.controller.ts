import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { UserService } from './user.service';

@Controller('api')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  async getMe(@Req() req: Request) {
    const token = req.cookies?.session_token ?? null;
    const result = await this.userService.getMe(token);

    if (!result?.Success) {
      throw new UnauthorizedException();
    }

    return result;
  }

  @Get('my-databases')
  async getMyDatabases(@Req() req: Request) {
    const token = req.cookies?.session_token ?? null;
    const rows = await this.userService.getMyDatabases(token);

    if (rows.length === 1 && rows[0].Success === false) {
      throw new UnauthorizedException();
    }

    return rows;
  }
}
