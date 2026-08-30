import "fake-indexeddb/auto";
import { afterAll, describe, expect, it, vi } from "vitest";

Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

import {
  getGroup,
  getPayment,
  getSettings,
  listOutbox,
  listPayments,
  removeGroup,
  saveGroup,
  savePayment,
  saveSettings,
} from "../src/lib/db";
import type { Payment } from "../src/lib/types";

const databaseName = "payment-manager-local";

function payment(id: string): Payment {
  const timestamp = new Date().toISOString();
  return {
    id,
    amount: 1200,
    paymentMethodId: "default-method-0",
    title: "テスト",
    groupId: null,
    paidAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

describe("IndexedDB entity/outbox atomicity", () => {
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it("commits the payment and its outbox operation together", async () => {
    const saved = payment("atomic-success");

    await savePayment(saved);

    expect(await getPayment(saved.id)).toEqual(saved);
    expect((await listOutbox()).some((entry) => entry.entityId === saved.id && entry.type === "PAYMENT_UPSERT")).toBe(true);
  });

  it("rolls back the payment when the outbox write fails", async () => {
    const failed = payment("atomic-failure");
    const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore) {
      if (this.name === "outbox") throw new Error("simulated outbox failure");
      throw new Error("unexpected object store");
    });

    await expect(savePayment(failed)).rejects.toThrow("simulated outbox failure");
    add.mockRestore();

    expect(await getPayment(failed.id)).toBeUndefined();
    expect((await listOutbox()).some((entry) => entry.entityId === failed.id)).toBe(false);
    expect((await listPayments()).some((item) => item.id === failed.id)).toBe(false);
  });

  it("rolls back every group-delete change when an outbox write fails", async () => {
    const timestamp = new Date().toISOString();
    const group = {
      id: "atomic-group-failure",
      name: "テストグループ",
      status: "active" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    const groupedPayment = { ...payment("atomic-group-payment"), groupId: group.id };
    const settings = { id: "local" as const, currentGroupId: group.id, createdAt: timestamp, updatedAt: timestamp };

    await saveGroup(group);
    await savePayment(groupedPayment);
    await saveSettings(settings);
    const beforeOutbox = (await listOutbox()).map((entry) => entry.id).sort();

    const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore) {
      if (this.name === "outbox") throw new Error("simulated outbox failure");
      throw new Error("unexpected object store");
    });

    await expect(removeGroup(group.id)).rejects.toThrow("simulated outbox failure");
    add.mockRestore();

    expect(await getGroup(group.id)).toEqual(group);
    expect(await getPayment(groupedPayment.id)).toEqual(groupedPayment);
    expect(await getSettings()).toEqual(settings);
    expect((await listOutbox()).map((entry) => entry.id).sort()).toEqual(beforeOutbox);
  });
});
