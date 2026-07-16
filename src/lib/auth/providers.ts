import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import { env } from "@/config/env";

export const googleProvider = GoogleProvider({
  clientId: env.AUTH_GOOGLE_ID ?? "",
  clientSecret: env.AUTH_GOOGLE_SECRET ?? "",
  allowDangerousEmailAccountLinking: false,
});

export const gitHubProvider = GitHubProvider({
  clientId: env.AUTH_GITHUB_ID ?? "",
  clientSecret: env.AUTH_GITHUB_SECRET ?? "",
  allowDangerousEmailAccountLinking: false,
});