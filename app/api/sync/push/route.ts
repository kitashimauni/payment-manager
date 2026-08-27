import { NextResponse } from "next/server";

/**
 * Sync contract for the Local First client.
 *
 * The MVP is usable without a server. A production deployment can replace
 * this handler with the PostgreSQL/Drizzle implementation described in docs.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { operations?: Array<{ id: string }> } | null;
  return NextResponse.json(
    {
      accepted: [],
      changes: [],
      nextCursor: null,
      reason: "server-sync-not-configured",
      received: body?.operations?.length ?? 0,
    },
    { status: 503 },
  );
}
