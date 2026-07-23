import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import type OAuth2Strategy from 'passport-oauth2';
import { OAuthProfile } from '../oauth/oauth-profile.interface';
import { SignedStateStore } from '../oauth/signed-state.store';

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface GitHubProfile {
  id: string;
  username?: string;
  displayName?: string | null;
}

type Done = (err: Error | null, user?: Express.User) => void;

@Injectable()
export class GitHubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(config: ConfigService) {
    super({
      clientID: config.getOrThrow<string>('AUTH_GITHUB_ID'),
      clientSecret: config.getOrThrow<string>('AUTH_GITHUB_SECRET'),
      callbackURL: `${config.getOrThrow<string>('PUBLIC_BASE_URL')}/api/auth/github/callback`,
      scope: ['user:email'],
      store: new SignedStateStore(config.getOrThrow<string>('AUTH_SECRET')) as unknown as OAuth2Strategy.StateStore,
    });
  }

  async validate(
    accessToken: string,
    _refreshToken: string,
    profile: GitHubProfile,
    done: Done,
  ): Promise<void> {
    // GitHub does not include verification in the profile; ask the API.
    let email: string | null = null;
    let emailVerified = false;

    try {
      const res = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'big-o-backend',
        },
      });

      if (res.ok) {
        const emails = (await res.json()) as GitHubEmail[];
        const primary = emails.find((e) => e.primary);
        if (primary) {
          email = primary.email;
          emailVerified = primary.verified === true;
        }
      }
    } catch {
      // fail-closed: leave email null / emailVerified false
    }

    const oauth: OAuthProfile = {
      provider: 'github',
      providerAccountId: String(profile.id),
      email,
      name: profile.displayName || profile.username || '',
      emailVerified,
    };
    done(null, oauth as unknown as Express.User);
  }
}
