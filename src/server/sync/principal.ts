import { eq } from "drizzle-orm";
import { auth, authEnabled } from "@/auth";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { EXPECTED_USER_HEADER, readAuthMode, SINGLE_USER_MODE, verifyTrustedProxyRequest } from "./auth-mode";

export type SyncPrincipal = {
  userId: string;
  mode: "oauth" | typeof SINGLE_USER_MODE;
  displayName: string;
};
export type SyncPrincipalResult =
  | { ok: true; principal: SyncPrincipal }
  | { ok: false; status: number; reason: string };

/** Authentication is server-derived; the expected user header is only an equality guard. */
export async function resolveSyncPrincipal(request: Request, requireExpectedUser = false): Promise<SyncPrincipalResult> {
  const mode = readAuthMode();
  if (mode.mode === "local-only" || !db) return { ok: false, status: 503, reason: "server-sync-not-configured" };

  let principal: SyncPrincipal;
  if (mode.mode === SINGLE_USER_MODE) {
    if (!verifyTrustedProxyRequest(request, mode)) return { ok: false, status: 403, reason: "trusted-proxy-required" };
    principal = { userId: mode.singleUserId!, mode: SINGLE_USER_MODE, displayName: "Tailnet 単一ユーザー" };
  } else {
    if (!authEnabled) return { ok: false, status: 503, reason: "server-sync-not-configured" };
    try {
      const session = await auth();
      if (!session?.user?.id) return { ok: false, status: 401, reason: "authentication-required" };
      principal = {
        userId: session.user.id,
        mode: "oauth",
        displayName: session.user.name ?? session.user.email ?? "このアカウント",
      };
    } catch {
      return { ok: false, status: 503, reason: "authentication-unavailable" };
    }
  }

  const expected = request.headers.get(EXPECTED_USER_HEADER);
  if ((requireExpectedUser && mode.mode === SINGLE_USER_MODE && !expected) || (expected !== null && expected !== principal.userId)) {
    return { ok: false, status: 409, reason: "sync-owner-changed" };
  }

  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, principal.userId)).limit(1);
    if (!user) return { ok: false, status: 503, reason: "sync-user-not-initialized" };
  } catch {
    return { ok: false, status: 503, reason: "database-unavailable" };
  }
  return { ok: true, principal };
}
