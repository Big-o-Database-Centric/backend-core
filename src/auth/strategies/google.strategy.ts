import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile, type VerifyCallback } from 'passport-google-oauth20';
import type OAuth2Strategy from 'passport-oauth2';
import { OAuthProfile } from '../oauth/oauth-profile.interface';
import { SignedStateStore } from '../oauth/signed-state.store';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.getOrThrow<string>('AUTH_GOOGLE_ID'),
      clientSecret: config.getOrThrow<string>('AUTH_GOOGLE_SECRET'),
      callbackURL: `${config.getOrThrow<string>('PUBLIC_BASE_URL')}/api/auth/google/callback`,
      scope: ['profile', 'email'],
      store: new SignedStateStore(config.getOrThrow<string>('AUTH_SECRET')) as unknown as OAuth2Strategy.StateStore,
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const oauth: OAuthProfile = {
      provider: 'google',
      providerAccountId: profile.id,
      email: profile.emails?.[0]?.value ?? null,
      name: profile.displayName ?? '',
      emailVerified: (profile._json as { email_verified?: boolean }).email_verified === true,
    };
    done(null, oauth as unknown as Express.User);
  }
}
