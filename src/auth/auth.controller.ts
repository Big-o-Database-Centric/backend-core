import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { OAuthProfile } from './oauth/oauth-profile.interface';

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

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleStart(): void {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    return this.finishOAuth(req.user as unknown as OAuthProfile, res);
  }

  @Get('github')
  @UseGuards(AuthGuard('github'))
  githubStart(): void {}

  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  async githubCallback(@Req() req: Request, @Res() res: Response) {
    return this.finishOAuth(req.user as unknown as OAuthProfile, res);
  }

  private async finishOAuth(profile: OAuthProfile, res: Response): Promise<void> {
    const result = await this.authService.oauthLogin(profile);

    if (!result?.Success) {
      const code =
        result?.Message?.includes('verificado') ? 'oauth_email_not_verified' : 'oauth_failed';
      res.redirect(`/views/login.html?error=${code}`);
      return;
    }

    res.cookie('session_token', result.SessionToken as string, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
    res.redirect('/views/dashboard.html');
  }
}
