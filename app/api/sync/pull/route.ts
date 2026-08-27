import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const cursor = new URL(request.url).searchParams.get("cursor");
  return NextResponse.json({ changes: [], nextCursor: cursor ?? "local-only" });
}
