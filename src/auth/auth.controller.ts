import { Body, Controller, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
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
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('session_token');
    return { success: true };
  }
}
