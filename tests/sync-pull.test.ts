import { describe, expect, it } from "vitest";
import {
  compareSyncPositions,
  decodeCursor,
  encodeCursor,
  isAfterCursor,
  type SyncPosition,
} from "@/server/sync/pull";

const position = (kind: SyncPosition["kind"], id: string, updatedAt = "2026-09-06T00:00:00.000Z"): SyncPosition => ({
  kind,
  id,
  updatedAt: new Date(updatedAt),
});

describe("sync pull cursor", () => {
  it("round-trips a canonical cursor and only returns later positions", () => {
    const current = position("groups", "group-1");
    const encoded = encodeCursor(current);
    const cursor = decodeCursor(encoded);

    expect(cursor).toEqual({
      version: 1,
      updatedAt: "2026-09-06T00:00:00.000Z",
      kind: "groups",
      id: "group-1",
    });
    expect(isAfterCursor(current, cursor)).toBe(false);
    expect(isAfterCursor(position("groups", "group-2"), cursor)).toBe(true);
    expect(isAfterCursor(position("paymentMethods", "method-1"), cursor)).toBe(true);
  });

  it("uses entity kind as a stable tie-breaker for equal timestamps", () => {
    const groupsPosition = position("groups", "same-id");
    const methodsPosition = position("paymentMethods", "same-id");

    expect(compareSyncPositions(groupsPosition, methodsPosition)).toBeLessThan(0);
    expect(isAfterCursor(methodsPosition, decodeCursor(encodeCursor(groupsPosition)))).toBe(true);
  });

  it("rejects malformed or non-canonical cursors", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow("valid opaque cursor");
    const nonCanonical = Buffer.from(
      JSON.stringify({ version: 1, updatedAt: "2026-09-06", kind: "payments", id: "payment-1" }),
      "utf8",
    ).toString("base64url");
    expect(() => decodeCursor(nonCanonical)).toThrow("canonical ISO timestamp");
  });
});
