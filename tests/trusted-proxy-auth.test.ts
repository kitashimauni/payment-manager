import { describe, expect, it } from "vitest";
import {
  EXPECTED_USER_HEADER,
  PROXY_TOKEN_HEADER,
  readAuthMode,
  SINGLE_USER_MODE,
  verifyTrustedProxyRequest,
} from "../src/server/sync/auth-mode";

const uuid = "8ed64442-9980-43c3-9289-e509032b6d1c";
const token = Buffer.alloc(48, 42).toString("base64url");
const origin = "https://payments.example.com";
const trustedEnv = {
  AUTH_MODE: SINGLE_USER_MODE,
  DATABASE_URL: "postgres://db/testing",
  SINGLE_USER_ID: uuid,
  TRUSTED_PROXY_TOKEN: token,
  TRUSTED_PROXY_ORIGIN: origin,
};
const trusted = readAuthMode(trustedEnv);

function request(method: string, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/sync/push`, {
    method,
    headers: { [PROXY_TOKEN_HEADER]: token, ...(method === "POST" ? { Origin: origin } : {}), ...headers },
  });
}

describe("explicit authentication mode selection", () => {
  it("preserves legacy auto and explicit local-only/google modes", () => {
    expect(readAuthMode({}).mode).toBe("auto");
    expect(readAuthMode({ AUTH_MODE: "local-only", AUTH_GOOGLE_ID: "unused" }).mode).toBe("local-only");
    expect(() => readAuthMode({ AUTH_MODE: "google" })).toThrow("requires");
    expect(readAuthMode({ AUTH_MODE: "google", DATABASE_URL: "db", AUTH_SECRET: "secret", AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "secret" }).mode).toBe("google");
    expect(() => readAuthMode({ AUTH_MODE: "anonymous" })).toThrow("AUTH_MODE");
    expect(() => readAuthMode({ AUTH_MODE: "" })).toThrow("AUTH_MODE");
  });

  it("fails closed on incomplete or contradictory trusted mode", () => {
    expect(trusted).toMatchObject({ singleUserId: uuid, proxyOrigin: origin });
    for (const [key, invalid] of [
      ["DATABASE_URL", ""], ["SINGLE_USER_ID", "not-a-uuid"], ["TRUSTED_PROXY_TOKEN", "too-short"],
      ["TRUSTED_PROXY_ORIGIN", "http://payments.example.com"],
      ["TRUSTED_PROXY_ORIGIN", `${origin}/`],
      ["AUTH_SECRET", "oauth-secret"], ["E2E_AUTH_USER_ID", uuid],
    ]) {
      expect(() => readAuthMode({ ...trustedEnv, [key]: invalid })).toThrow();
    }
  });
});

describe("trusted proxy authentication boundary", () => {
  it("accepts only a trusted same-origin request", () => {
    expect(verifyTrustedProxyRequest(request("POST", { "Sec-Fetch-Site": "same-origin", [EXPECTED_USER_HEADER]: uuid }), trusted)).toBe(true);
    expect(verifyTrustedProxyRequest(request("GET", { "Sec-Fetch-Site": "same-origin" }), trusted)).toBe(true);
    expect(verifyTrustedProxyRequest(request("GET"), trusted)).toBe(true);
  });

  it("rejects direct requests, spoofed headers, invalid origins and cross-site metadata", () => {
    const invalidHeaders: Record<string, string>[] = [
      { [PROXY_TOKEN_HEADER]: "" },
      { [PROXY_TOKEN_HEADER]: Buffer.alloc(48, 43).toString("base64url") },
      { [PROXY_TOKEN_HEADER]: "x".repeat(513) },
      { Origin: "https://evil.example.com" },
      { Origin: "null" },
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
      { "Sec-Fetch-Site": "invalid" },
    ];
    for (const headers of invalidHeaders) {
      expect(verifyTrustedProxyRequest(request("POST", headers), trusted)).toBe(false);
    }
    expect(verifyTrustedProxyRequest(request("POST", { Origin: "" }), trusted)).toBe(false);
    expect(verifyTrustedProxyRequest(request("GET", { Origin: "https://evil.example.com" }), trusted)).toBe(false);
    expect(verifyTrustedProxyRequest(request("POST"), { mode: "local-only" })).toBe(false);
  });

  it("does not accept a user ID or forwarded address as authentication", () => {
    const headers = { [PROXY_TOKEN_HEADER]: "", [EXPECTED_USER_HEADER]: uuid, "X-Forwarded-For": "100.100.100.100", "Tailscale-User-Login": "owner@example.com" };
    expect(verifyTrustedProxyRequest(request("POST", headers), trusted)).toBe(false);
  });
});
