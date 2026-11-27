import { createHash, timingSafeEqual } from "node:crypto";

export const PROXY_TOKEN_HEADER = "x-payment-manager-proxy-token";
export const EXPECTED_USER_HEADER = "x-payment-manager-expected-user";
export const SINGLE_USER_MODE = "trusted-proxy-single-user";

export type AuthMode = "auto" | "google" | "local-only" | typeof SINGLE_USER_MODE;
export type AuthModeConfig = {
  mode: AuthMode;
  singleUserId?: string;
  proxyToken?: string;
  proxyOrigin?: string;
};

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validProxyToken(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length >= 32 && decoded.toString("base64url") === value;
}

function validHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Validate explicit mode selection without silently enabling anonymous sync. */
export function readAuthMode(env: Record<string, string | undefined> = process.env): AuthModeConfig {
  const mode = env.AUTH_MODE === undefined ? "auto" : env.AUTH_MODE;
  if (mode !== "auto" && mode !== "google" && mode !== "local-only" && mode !== SINGLE_USER_MODE) {
    throw new Error("AUTH_MODE must be auto, google, local-only, or trusted-proxy-single-user");
  }

  if (mode === "google" && (!env.DATABASE_URL || !env.AUTH_SECRET || !env.AUTH_GOOGLE_ID || !env.AUTH_GOOGLE_SECRET)) {
    throw new Error("AUTH_MODE=google requires DATABASE_URL, AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET");
  }

  if (mode !== SINGLE_USER_MODE) return { mode };

  if (env.AUTH_SECRET || env.AUTH_GOOGLE_ID || env.AUTH_GOOGLE_SECRET || env.E2E_AUTH_USER_ID || env.E2E_AUTH_SECRET) {
    throw new Error("Trusted proxy single-user mode cannot be combined with OAuth or E2E credentials");
  }
  if (!env.DATABASE_URL) throw new Error("Trusted proxy single-user mode requires DATABASE_URL");
  if (!env.SINGLE_USER_ID || !isUuid(env.SINGLE_USER_ID)) {
    throw new Error("Trusted proxy single-user mode requires a fixed UUID in SINGLE_USER_ID");
  }
  if (!env.TRUSTED_PROXY_TOKEN || !validProxyToken(env.TRUSTED_PROXY_TOKEN)) {
    throw new Error("TRUSTED_PROXY_TOKEN must be at least 32 random bytes encoded as base64url");
  }
  if (!env.TRUSTED_PROXY_ORIGIN || !validHttpsOrigin(env.TRUSTED_PROXY_ORIGIN)) {
    throw new Error("TRUSTED_PROXY_ORIGIN must be an exact HTTPS origin without a path or trailing slash");
  }

  return {
    mode,
    singleUserId: env.SINGLE_USER_ID,
    proxyToken: env.TRUSTED_PROXY_TOKEN,
    proxyOrigin: env.TRUSTED_PROXY_ORIGIN,
  };
}

/** Never treat client-supplied Host, Forwarded or Tailscale identity headers as proof. */
export function verifyTrustedProxyRequest(request: Request, config: AuthModeConfig): boolean {
  if (config.mode !== SINGLE_USER_MODE || !config.proxyToken || !config.proxyOrigin) return false;

  const supplied = request.headers.get(PROXY_TOKEN_HEADER);
  if (!supplied || supplied.length > 512) return false;
  const actualDigest = createHash("sha256").update(supplied).digest();
  const expectedDigest = createHash("sha256").update(config.proxyToken).digest();
  if (!timingSafeEqual(actualDigest, expectedDigest)) return false;

  // Browsers send Origin on same-origin POST; reject even when the proxy token is valid.
  const origin = request.headers.get("origin");
  if (request.method.toUpperCase() === "POST" && origin !== config.proxyOrigin) return false;
  if (origin !== null && origin !== config.proxyOrigin) return false;

  // Same-site but cross-origin subdomains must not inherit access.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  return true;
}
