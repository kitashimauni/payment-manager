import "fake-indexeddb/auto";
import { afterAll, describe, expect, it, vi } from "vitest";

const windowMock = new EventTarget();
Object.defineProperty(windowMock, "indexedDB", { value: globalThis.indexedDB });
Object.defineProperty(globalThis, "window", { value: windowMock, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

import {
  getGroup,
  getPayment,
  getSettings,
  listPaymentMethods,
  listOutbox,
  listPayments,
  removeGroup,
  saveGroup,
  savePayment,
  savePaymentMethod,
  saveSettings,
  subscribeToOutboxChanges,
  trySync,
} from "../src/lib/db";
import type { Payment, PaymentMethod } from "../src/lib/types";

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

  it("notifies subscribers after an outbox-backed write commits", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToOutboxChanges(listener);

    await savePayment(payment("outbox-change"));

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("keeps archived payment methods in the full display list", async () => {
    const timestamp = new Date().toISOString();
    const active: PaymentMethod = {
      id: "method-active",
      name: "利用中",
      sortOrder: 0,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    const archived: PaymentMethod = {
      id: "method-archived",
      name: "アーカイブ済み",
      sortOrder: 1,
      isActive: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };

    await savePaymentMethod(active);
    await savePaymentMethod(archived);

    expect(await listPaymentMethods()).toEqual([active]);
    expect(await listPaymentMethods(true)).toEqual([active, archived]);
  });

  it("notifies subscribers after sync removes accepted outbox entries", async () => {
    const outbox = await listOutbox();
    const listener = vi.fn();
    const unsubscribe = subscribeToOutboxChanges(listener);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: outbox.map((entry) => entry.id) }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(trySync()).resolves.toBe("synced");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(await listOutbox()).toEqual([]);
    fetchMock.mockRestore();
    unsubscribe();
  });
});
