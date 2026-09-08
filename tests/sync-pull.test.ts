import { describe, expect, it } from "vitest";
import {
  compareSyncPositions,
  decodeCursor,
  encodeCursor,
  isAfterCursor,
  type SyncPosition,
} from "@/server/sync/pull";
import { parseSyncPullResponse, parseSyncPushResponse } from "@/lib/sync";

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

  it("validates pull changes before they reach IndexedDB", () => {
    const response = parseSyncPullResponse({
      changes: [{
        type: "PAYMENT_DELETE",
        entityId: "payment-1",
        payload: {
          id: "payment-1",
          amount: 100,
          paymentMethodId: "method-1",
          title: null,
          groupId: null,
          paidAt: "2026-09-07T00:00:00.000Z",
          createdAt: "2026-09-07T00:00:00.000Z",
          updatedAt: "2026-09-07T00:01:00.000Z",
          deletedAt: "2026-09-07T00:01:00.000Z",
        },
      }],
      nextCursor: "opaque-cursor",
      hasMore: false,
    });

    expect(response.changes[0].type).toBe("PAYMENT_DELETE");
    expect(() => parseSyncPullResponse({ changes: [], nextCursor: null, hasMore: "false" })).toThrow("hasMore");
  });

  it("validates authoritative changes in a push response", () => {
    const response = parseSyncPushResponse({
      accepted: ["operation-1"],
      changes: [{
        type: "GROUP_UPSERT",
        entityId: "group-1",
        payload: {
          id: "group-1",
          name: "仕事",
          status: "active",
          createdAt: "2026-09-07T00:00:00.000Z",
          updatedAt: "2026-09-07T00:01:00.000Z",
          deletedAt: null,
        },
      }],
    });

    expect(response.accepted).toEqual(["operation-1"]);
    expect(response.changes[0].entityId).toBe("group-1");
    expect(() => parseSyncPushResponse({ accepted: ["operation-1"], changes: [] })).not.toThrow();
  });
});
