import "fake-indexeddb/auto";
import { afterAll, describe, expect, it, vi } from "vitest";

const windowMock = new EventTarget();
Object.defineProperty(windowMock, "indexedDB", { value: globalThis.indexedDB });
Object.defineProperty(globalThis, "window", { value: windowMock, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

import { bulkUpdatePayments, getPayment, listOutbox, listPayments, savePayment, subscribeToLocalDataChanges } from "../src/lib/db";
import type { Payment } from "../src/lib/types";

const databaseName = "payment-manager-local";

function payment(id: string, overrides: Partial<Payment> = {}): Payment {
  const timestamp = "2026-09-09T12:00:00.000Z";
  return {
    id,
    amount: 1200,
    paymentMethodId: "default-method-0",
    title: id,
    groupId: null,
    paidAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

describe("bulk payment updates", () => {
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it("updates selected visible payments together and notifies local subscribers", async () => {
    const first = payment("bulk-first");
    const second = payment("bulk-second");
    await savePayment(first);
    await savePayment(second);
    const changes: string[] = [];
    const unsubscribe = subscribeToLocalDataChanges((change) => changes.push(change.entityId));

    const result = await bulkUpdatePayments([first.id, second.id, first.id], { groupId: "bulk-group", paymentMethodId: "default-method-1" });

    expect(result).toEqual({ updated: 2 });
    expect(await getPayment(first.id)).toMatchObject({ groupId: "bulk-group", paymentMethodId: "default-method-1", updatedAt: expect.any(String) });
    expect(await getPayment(second.id)).toMatchObject({ groupId: "bulk-group", paymentMethodId: "default-method-1", updatedAt: expect.any(String) });
    expect(changes).toEqual(expect.arrayContaining([first.id, second.id]));
    expect((await listOutbox()).filter((entry) => [first.id, second.id].includes(entry.entityId)).map((entry) => entry.type)).toEqual(expect.arrayContaining(["PAYMENT_UPSERT"]));

    unsubscribe();
  });

  it("logically deletes only selected active payments", async () => {
    const first = payment("bulk-delete-first");
    const second = payment("bulk-delete-second");
    await savePayment(first);
    await savePayment(second);

    expect(await bulkUpdatePayments([first.id], { delete: true })).toEqual({ updated: 1 });
    expect(await getPayment(first.id)).toMatchObject({ deletedAt: expect.any(String), updatedAt: expect.any(String) });
    expect(await listPayments()).not.toContainEqual(expect.objectContaining({ id: first.id }));
    expect(await listPayments()).toContainEqual(second);
    expect((await listOutbox()).some((entry) => entry.entityId === first.id && entry.type === "PAYMENT_DELETE")).toBe(true);
  });

  it("does not leave partial entity writes when an outbox write fails", async () => {
    const first = payment("bulk-rollback-first");
    const second = payment("bulk-rollback-second");
    await savePayment(first);
    await savePayment(second);
    const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore) {
      if (this.name === "outbox") throw new Error("simulated bulk outbox failure");
      throw new Error("unexpected object store");
    });

    await expect(bulkUpdatePayments([first.id, second.id], { groupId: "should-not-commit" })).rejects.toThrow("simulated bulk outbox failure");
    add.mockRestore();

    expect(await getPayment(first.id)).toEqual(first);
    expect(await getPayment(second.id)).toEqual(second);
    expect((await listOutbox()).some((entry) => entry.entityId === first.id && entry.payload && (entry.payload as Payment).groupId === "should-not-commit")).toBe(false);
  });

  it("rejects an empty payment method action without opening a write", async () => {
    await expect(bulkUpdatePayments(["missing"], { paymentMethodId: "" })).rejects.toThrow("支払い方法を指定してください。");
  });
});
