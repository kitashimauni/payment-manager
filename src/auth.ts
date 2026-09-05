import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/server/db/client";
import { accounts, users } from "@/server/db/schema";

const googleClientId = process.env.AUTH_GOOGLE_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET;

/**
 * Authentication is deliberately opt-in. An incomplete OAuth/database setup
 * keeps the app in Local Only mode instead of making local entry unavailable.
 */
export const authEnabled = Boolean(
  process.env.AUTH_SECRET && googleClientId && googleClientSecret && db,
);

const adapter = db
  ? DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
    })
  : undefined;

const googleProvider = authEnabled
  ? Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    })
  : null;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers: googleProvider ? [googleProvider] : [],
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET,
});
