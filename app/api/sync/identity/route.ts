import { NextResponse } from "next/server";
import { readAuthMode } from "@/server/sync/auth-mode";
import { resolveSyncPrincipal } from "@/server/sync/principal";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (readAuthMode().mode === "local-only") {
    return NextResponse.json({ status: "local-only", userId: null }, { headers });
  }

  const result = await resolveSyncPrincipal(request);
  if (!result.ok) {
    return NextResponse.json({ status: "unavailable", userId: null, reason: result.reason }, { status: result.status, headers });
  }
  return NextResponse.json({
    status: "authenticated",
    mode: result.principal.mode,
    userId: result.principal.userId,
    displayName: result.principal.displayName,
  }, { headers });
}
