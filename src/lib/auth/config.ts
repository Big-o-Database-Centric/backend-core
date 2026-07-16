import NextAuth from "next-auth";
import { googleProvider, gitHubProvider } from "@/lib/auth/providers";
import {
  signInCallback,
  jwtCallback,
  sessionCallback,
} from "@/lib/auth/callbacks";
import { env } from "@/config/env";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [googleProvider, gitHubProvider],
  secret: env.AUTH_SECRET,
  trustHost: env.AUTH_TRUST_HOST,
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    signIn: signInCallback,
    jwt: jwtCallback,
    session: sessionCallback,
  },
  events: {
    async createUser(message) {
      console.log("[auth] createUser event:", message.user.id);
    },
    async signOut(message) {
      if ("token" in message && message.token) {
        console.log("[auth] signOut event - token sub:", message.token.sub);
      } else if ("session" in message) {
        console.log("[auth] signOut event - session ended");
      }
    },
  },
  logger: {
    error(error) {
      console.error("[next-auth] error:", error.name, error.message);
    },
    warn(code) {
      console.warn("[next-auth] warning:", code);
    },
    debug(code, metadata) {
      if (process.env.NODE_ENV === "development" && process.env.DEBUG) {
        console.debug("[next-auth] debug:", code, metadata);
      }
    },
  },
});