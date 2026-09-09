import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { db } from "@/server/db/client";
import { accounts, users } from "@/server/db/schema";

const googleClientId = process.env.AUTH_GOOGLE_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET;
const e2eAuthUserId = process.env.E2E_AUTH_USER_ID;
const e2eAuthSecret = process.env.E2E_AUTH_SECRET;

/**
 * Authentication is deliberately opt-in. An incomplete OAuth/database setup
 * keeps the app in Local Only mode instead of making local entry unavailable.
 */
const googleAuthEnabled = Boolean(
  process.env.AUTH_SECRET && googleClientId && googleClientSecret && db,
);
export const e2eAuthEnabled = Boolean(process.env.AUTH_SECRET && db && e2eAuthUserId && e2eAuthSecret);
export const authEnabled = googleAuthEnabled || e2eAuthEnabled;

const adapter = db
  ? DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
    })
  : undefined;

const googleProvider = authEnabled
  ? googleAuthEnabled
    ? Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      })
    : null
  : null;

const e2eProvider = e2eAuthEnabled
  ? Credentials({
      id: "e2e",
      name: "E2E test user",
      credentials: {
        accessKey: { label: "Access key", type: "password" },
      },
      async authorize(credentials) {
        if (!db || !e2eAuthUserId || !e2eAuthSecret || credentials?.accessKey !== e2eAuthSecret) return null;

        await db.insert(users).values({ id: e2eAuthUserId, name: "Playwright Sync User" }).onConflictDoNothing({ target: users.id });
        const [user] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, e2eAuthUserId)).limit(1);
        return user?.id ? { id: user.id, name: user.name } : null;
      },
    })
  : null;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers: [googleProvider, e2eProvider].filter((provider): provider is NonNullable<typeof provider> => provider !== null),
  trustHost: e2eAuthEnabled,
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET,
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
