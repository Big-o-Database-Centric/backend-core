import { Body, Controller, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.name, dto.email, dto.password);
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto.email, dto.password);

    if (!result?.Success) {
      throw new UnauthorizedException(result?.Message ?? 'Invalid credentials');
    }

    res.cookie('session_token', result.SessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });

    return result;
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.session_token ?? null;
    await this.authService.logout(token);
    res.clearCookie('session_token');
    return { success: true };
  }
}
