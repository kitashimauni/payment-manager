import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROXY_TOKEN_HEADER } from "../src/server/sync/auth-mode";

const { sessionUser, databaseRows } = vi.hoisted(() => ({
  sessionUser: { current: "8ed64442-9980-43c3-9289-e509032b6d1c" },
  databaseRows: { current: [{ id: "8ed64442-9980-43c3-9289-e509032b6d1c" }] as { id: string }[] },
}));
vi.mock("@/auth", () => ({
  authEnabled: true,
  auth: async () => sessionUser.current ? { user: { id: sessionUser.current, name: "OAuth user" } } : null,
}));
vi.mock("@/server/db/client", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => databaseRows.current }) }) }) },
}));

import { resolveSyncPrincipal } from "../src/server/sync/principal";

const userId = "8ed64442-9980-43c3-9289-e509032b6d1c";
const token = Buffer.alloc(48, 42).toString("base64url");
const origin = "https://payments.example.com";
const trustedVariables = {
  AUTH_MODE: "trusted-proxy-single-user",
  DATABASE_URL: "postgres://db/testing",
  SINGLE_USER_ID: userId,
  TRUSTED_PROXY_TOKEN: token,
  TRUSTED_PROXY_ORIGIN: origin,
};

function trustedRequest(path = "/api/sync/push", headers: Record<string, string> = {}) {
  return new Request(origin + path, {
    method: "POST",
    headers: { Origin: origin, [PROXY_TOKEN_HEADER]: token, "X-Payment-Manager-Expected-User": userId, ...headers },
  });
}

describe("server-derived sync principal", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(trustedVariables)) vi.stubEnv(key, value);
    databaseRows.current = [{ id: userId }];
    sessionUser.current = userId;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("resolves the same fixed principal for two devices independent of client headers", async () => {
    const desktop = await resolveSyncPrincipal(trustedRequest(), true);
    const phone = await resolveSyncPrincipal(trustedRequest("/api/sync/pull"), true);
    expect(desktop).toMatchObject({ ok: true, principal: { userId, mode: "trusted-proxy-single-user" } });
    expect(phone).toEqual(desktop);
  });

  it("rejects missing proxy trust, missing expected owner or changed owner", async () => {
    const noProxy = await resolveSyncPrincipal(trustedRequest(undefined, { [PROXY_TOKEN_HEADER]: "" }), true);
    expect(noProxy).toMatchObject({ ok: false, status: 403 });
    const noOwner = await resolveSyncPrincipal(trustedRequest(undefined, { "X-Payment-Manager-Expected-User": "" }), true);
    expect(noOwner).toMatchObject({ ok: false, status: 409, reason: "sync-owner-changed" });
    const changed = await resolveSyncPrincipal(trustedRequest(undefined, { "X-Payment-Manager-Expected-User": "other-user" }), true);
    expect(changed).toMatchObject({ ok: false, status: 409 });
  });

  it("requires explicit bootstrap and never silently creates a principal", async () => {
    databaseRows.current = [];
    expect(await resolveSyncPrincipal(trustedRequest(), true)).toMatchObject({ ok: false, status: 503, reason: "sync-user-not-initialized" });
  });

  it("preserves OAuth session authorization and blocks owner swaps", async () => {
    vi.stubEnv("AUTH_MODE", "auto");
    expect(await resolveSyncPrincipal(new Request(origin + "/api/sync/pull"), true)).toMatchObject({ ok: true, principal: { userId, mode: "oauth" } });
    expect(await resolveSyncPrincipal(new Request(origin, { headers: { "X-Payment-Manager-Expected-User": "other-user" } }), true)).toMatchObject({ ok: false, status: 409 });
    sessionUser.current = "";
    expect(await resolveSyncPrincipal(new Request(origin), true)).toMatchObject({ ok: false, status: 401 });
  });

  it("disables server sync in explicit Local Only mode", async () => {
    vi.stubEnv("AUTH_MODE", "local-only");
    expect(await resolveSyncPrincipal(trustedRequest(), true)).toMatchObject({ ok: false, status: 503 });
  });
});
