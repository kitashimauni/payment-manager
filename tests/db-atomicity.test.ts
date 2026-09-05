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
  listGroups,
  listPaymentMethods,
  listOutbox,
  listPayments,
  removeGroup,
  removePayment,
  saveGroup,
  savePayment,
  savePaymentMethod,
  saveSettings,
  subscribeToOutboxChanges,
  trySync,
} from "../src/lib/db";
import type { Payment, PaymentMethod } from "../src/lib/types";
import { createPayment } from "../src/lib/payment";

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

function group(id: string) {
  const timestamp = new Date().toISOString();
  return {
    id,
    name: "テストグループ",
    status: "active" as const,
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

  it("supports payment registration, editing, logical deletion, and undo", async () => {
    const saved = { ...payment("payment-flow"), title: null };
    await savePayment(saved);

    expect(await listPayments()).toContainEqual(saved);

    const edited = { ...saved, amount: 2400, title: "昼食", updatedAt: new Date().toISOString() };
    await savePayment(edited);

    expect(await getPayment(edited.id)).toEqual(edited);

    await removePayment(edited.id);

    expect(await getPayment(edited.id)).toMatchObject({ id: edited.id, deletedAt: expect.any(String) });
    expect((await listPayments()).some((item) => item.id === edited.id)).toBe(false);
    expect((await listOutbox()).some((entry) => entry.entityId === edited.id && entry.type === "PAYMENT_DELETE")).toBe(true);
  });

  it("automatically assigns the current group when creating a payment", async () => {
    const currentGroup = group("current-group-flow");
    const settings = {
      id: "local" as const,
      currentGroupId: currentGroup.id,
      createdAt: currentGroup.createdAt,
      updatedAt: currentGroup.updatedAt,
    };

    await saveGroup(currentGroup);
    await saveSettings(settings);
    const saved = createPayment({
      id: "current-group-payment",
      amount: 1800,
      paymentMethodId: "default-method-0",
      title: "",
      currentGroupId: (await getSettings())?.currentGroupId,
      timestamp: new Date().toISOString(),
    });
    await savePayment(saved);

    expect(saved.groupId).toBe(currentGroup.id);
    expect((await getPayment(saved.id))?.groupId).toBe(currentGroup.id);
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

  it("creates groups, toggles the current group, and unlinks payments on deletion", async () => {
    const createdGroup = group("group-flow");
    const groupedPayment = { ...payment("group-flow-payment"), groupId: createdGroup.id };
    const initialSettings = { id: "local" as const, currentGroupId: null, createdAt: createdGroup.createdAt, updatedAt: createdGroup.updatedAt };

    await saveGroup(createdGroup);
    await savePayment(groupedPayment);
    await saveSettings(initialSettings);

    expect(await listGroups()).toContainEqual(createdGroup);
    await saveSettings({ ...initialSettings, currentGroupId: createdGroup.id, updatedAt: new Date().toISOString() });
    expect((await getSettings())?.currentGroupId).toBe(createdGroup.id);
    await saveSettings({ ...initialSettings, currentGroupId: null, updatedAt: new Date().toISOString() });
    expect((await getSettings())?.currentGroupId).toBeNull();

    await saveSettings({ ...initialSettings, currentGroupId: createdGroup.id, updatedAt: new Date().toISOString() });
    await removeGroup(createdGroup.id);

    expect(await getGroup(createdGroup.id)).toMatchObject({ id: createdGroup.id, status: "archived", deletedAt: expect.any(String) });
    expect((await getPayment(groupedPayment.id))?.groupId).toBeNull();
    expect((await getSettings())?.currentGroupId).toBeNull();
    expect((await listGroups()).some((item) => item.id === createdGroup.id)).toBe(false);
    expect((await listOutbox()).some((entry) => entry.entityId === createdGroup.id && entry.type === "GROUP_DELETE")).toBe(true);
  });

  it("notifies subscribers after an outbox-backed write commits", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToOutboxChanges(listener);

    await savePayment(payment("outbox-change"));

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("supports payment method creation, sorting, archiving, and historical references", async () => {
    const timestamp = new Date().toISOString();
    const first: PaymentMethod = {
      id: "method-first",
      name: "先に表示",
      sortOrder: 0,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    const active: PaymentMethod = {
      id: "method-active",
      name: "利用中",
      sortOrder: 1,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    const archived: PaymentMethod = {
      id: "method-archived",
      name: "アーカイブ済み",
      sortOrder: 2,
      isActive: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };

    await savePaymentMethod(first);
    await savePaymentMethod(active);
    await savePaymentMethod(archived);

    expect(await listPaymentMethods()).toEqual([first, active]);

    const reorderedFirst = { ...first, sortOrder: 3, updatedAt: new Date().toISOString() };
    await savePaymentMethod(reorderedFirst);

    expect(await listPaymentMethods()).toEqual([active, reorderedFirst]);
    expect(await listPaymentMethods(true)).toEqual([active, archived, reorderedFirst]);

    const historicalPayment = { ...payment("archived-method-payment"), paymentMethodId: archived.id };
    await savePayment(historicalPayment);
    expect((await listPaymentMethods(true)).find((method) => method.id === historicalPayment.paymentMethodId)?.name).toBe(archived.name);
  });

  it("keeps the outbox when sync fails", async () => {
    const pendingPayment = payment("sync-failure");
    await savePayment(pendingPayment);
    const before = await listOutbox();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    await expect(trySync()).resolves.toBe("pending");

    expect(await listOutbox()).toEqual(before);
    fetchMock.mockRestore();
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
