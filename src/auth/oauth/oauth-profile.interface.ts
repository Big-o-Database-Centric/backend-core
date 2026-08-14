export interface OAuthProfile {
  provider: 'google' | 'github';
  providerAccountId: string;
  email: string | null;
  name: string;
  emailVerified: boolean;
}
