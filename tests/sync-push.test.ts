import { describe, expect, it } from "vitest";
import { parsePushRequest, PushValidationError } from "../src/server/sync/push";

const timestamp = "2026-09-05T00:00:00.000Z";

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: "operation-1",
    type: "PAYMENT_UPSERT",
    entityId: "payment-1",
    createdAt: timestamp,
    payload: {
      id: "payment-1",
      amount: 1200,
      paymentMethodId: "method-1",
      title: "昼食",
      groupId: null,
      paidAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      userId: "attacker-controlled-user-id",
    },
    ...overrides,
  };
}

describe("authenticated push payload validation", () => {
  it("parses supported operations without accepting a client user ID", () => {
    const result = parsePushRequest({ operations: [operation()] });

    expect(result.operations[0]).toMatchObject({
      id: "operation-1",
      type: "PAYMENT_UPSERT",
      entityId: "payment-1",
      payload: { id: "payment-1", amount: 1200 },
    });
    expect(result.operations[0].payload).not.toHaveProperty("userId");
  });

  it("accepts logical deletes and settings payloads", () => {
    const result = parsePushRequest({
      operations: [
        operation({
          id: "operation-delete",
          type: "PAYMENT_DELETE",
          payload: {
            ...operation().payload,
            deletedAt: timestamp,
          },
        }),
        {
          id: "operation-settings",
          type: "SETTINGS_UPSERT",
          entityId: "local",
          createdAt: timestamp,
          payload: {
            id: "local",
            currentGroupId: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      ],
    });

    expect(result.operations).toHaveLength(2);
    const [deletedOperation, settingsOperation] = result.operations;
    if (deletedOperation.type !== "PAYMENT_DELETE") throw new Error("expected a payment delete");
    expect(deletedOperation.payload.deletedAt).toBe(timestamp);
    expect(settingsOperation.type).toBe("SETTINGS_UPSERT");
    if (settingsOperation.type !== "SETTINGS_UPSERT") throw new Error("expected a settings upsert");
    expect(settingsOperation.payload).toMatchObject({ id: "local", currentGroupId: null });
  });

  it("rejects malformed operations before opening a database transaction", () => {
    expect(() =>
      parsePushRequest({
        operations: [operation({ entityId: "another-payment" })],
      }),
    ).toThrow(PushValidationError);

    expect(() =>
      parsePushRequest({
        operations: [operation({ type: "UNSUPPORTED" })],
      }),
    ).toThrow("operation.type is not supported");
  });

  it("rejects duplicate operation IDs", () => {
    expect(() => parsePushRequest({ operations: [operation(), operation()] })).toThrow(
      "request.operations must not contain duplicate IDs",
    );
  });
});
