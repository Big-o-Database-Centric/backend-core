import {
  getUserRepository,
  getAuditRepository,
} from "@/lib/auth/repository.factory";
import type { JWT } from "@auth/core/jwt";
import type { Account, User, Profile, Session } from "@auth/core/types";
import type { AdapterUser } from "@auth/core/adapters";

export const signInCallback = async (params: {
  user: User | AdapterUser;
  account?: Account | null;
  profile?: Profile;
}): Promise<boolean | string> => {
  const { user, account, profile } = params;
  if (!account || !profile) {
    console.error("[auth] signIn callback: account o profile ausentes");
    return false;
  }

  try {
    const dbUser = await getUserRepository().upsertOAuthUser({
      email: user.email ?? profile.email ?? null,
      name: user.name ?? profile.name ?? null,
      avatar: profile.picture ?? profile.avatar_url ?? user.image ?? null,
      provider: account.provider,
      provider_account_id: account.providerAccountId,
    });

    await getAuditRepository().log({
      user_id: dbUser.id,
      action: "LOGIN",
      target: account.provider,
      ip_address: null,
      details: `OAuth login via ${account.provider}`,
    });
  } catch (err) {
    console.error("[auth] signIn callback error:", err);
    return false;
  }

  return true;
};

export const jwtCallback = async (params: {
  token: JWT;
  user?: User | AdapterUser;
  account?: Account | null;
}) => {
  const { token, user, account } = params;
  if (account && user) {
    const repo = getUserRepository();
    const dbUser = await repo.findByProvider({
      provider: account.provider,
      provider_account_id: account.providerAccountId,
    });

    if (dbUser) {
      await repo.updateLastLogin(dbUser.id);
      return {
        ...token,
        userId: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        avatar: dbUser.avatar,
        provider: dbUser.provider,
        createdAt: dbUser.created_at.toISOString(),
        lastLoginAt: dbUser.last_login_at
          ? dbUser.last_login_at.toISOString()
          : null,
      };
    }
  }

  if (user) {
    return {
      ...token,
      userId: user.id,
      email: user.email,
      name: user.name,
      avatar: user.image,
    };
  }

  return token;
};

export const sessionCallback = async (params: {
  session: Session;
  token: JWT;
}): Promise<Session> => {
  const { session, token } = params;
  return {
    ...session,
    user: {
      ...session.user,
      id: (token.userId as string) ?? token.sub ?? null,
      email: (token.email as string) ?? session.user?.email ?? null,
      name: (token.name as string) ?? session.user?.name ?? null,
      image: (token.avatar as string) ?? (token.picture as string) ?? session.user?.image ?? null,
      provider: (token.provider as string) ?? null,
      createdAt: (token.createdAt as string) ?? null,
      lastLoginAt: (token.lastLoginAt as string) ?? null,
    },
  } as Session;
};