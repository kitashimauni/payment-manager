import { describe, expect, it } from "vitest";
import {
  compareSyncPositions,
  decodeCursor,
  encodeCursor,
  isAfterCursor,
  type SyncPosition,
} from "@/server/sync/pull";

const position = (kind: SyncPosition["kind"], id: string, syncVersion = BigInt(1)): SyncPosition => ({
  kind,
  id,
  syncVersion,
});

describe("sync pull cursor", () => {
  it("round-trips a canonical cursor and only returns later positions", () => {
    const current = position("groups", "group-1");
    const encoded = encodeCursor(current);
    const cursor = decodeCursor(encoded);

    expect(cursor).toEqual({
      version: 2,
      syncVersion: "1",
    });
    expect(isAfterCursor(current, cursor)).toBe(false);
    expect(isAfterCursor(position("groups", "group-2", BigInt(2)), cursor)).toBe(true);
    expect(isAfterCursor(position("paymentMethods", "method-1", BigInt(2)), cursor)).toBe(true);
  });

  it("orders positions by the server sequence", () => {
    const groupsPosition = position("groups", "same-id", BigInt(1));
    const methodsPosition = position("paymentMethods", "same-id", BigInt(2));

    expect(compareSyncPositions(groupsPosition, methodsPosition)).toBeLessThan(0);
    expect(isAfterCursor(methodsPosition, decodeCursor(encodeCursor(groupsPosition)))).toBe(true);
  });

  it("rejects malformed or non-canonical cursors", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow("valid opaque cursor");
    const invalidVersion = Buffer.from(JSON.stringify({ version: 1, syncVersion: "1" }), "utf8").toString("base64url");
    expect(() => decodeCursor(invalidVersion)).toThrow("valid opaque cursor");
    const invalidSyncVersion = Buffer.from(JSON.stringify({ version: 2, syncVersion: "0" }), "utf8").toString("base64url");
    expect(() => decodeCursor(invalidSyncVersion)).toThrow("valid sync version");
  });
});
