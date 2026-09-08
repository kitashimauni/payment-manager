import "fake-indexeddb/auto";
import { afterAll, describe, expect, it, vi } from "vitest";

const windowMock = new EventTarget();
Object.defineProperty(windowMock, "indexedDB", { value: globalThis.indexedDB });
Object.defineProperty(globalThis, "window", { value: windowMock, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

import { getGroup, getPayment, getSettings, importPaymentBackup, listGroups, listOutbox, listPaymentMethods, listPayments, savePayment, subscribeToLocalDataChanges } from "../src/lib/db";
import type { PaymentExportData } from "../src/lib/payment-export";
import { parsePaymentBackup } from "../src/lib/payment-import";
import type { Group, Payment, PaymentMethod, UserSettings } from "../src/lib/types";

const databaseName = "payment-manager-local";
const timestamp = "2026-09-09T12:00:00.000Z";

const group: Group = {
  id: "import-group",
  name: "取込グループ",
  status: "active",
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
};

const paymentMethod: PaymentMethod = {
  id: "import-method",
  name: "取込カード",
  sortOrder: 3,
  isActive: false,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
};

const settings: UserSettings = {
  id: "local",
  currentGroupId: group.id,
  createdAt: timestamp,
  updatedAt: timestamp,
};

function payment(id: string, overrides: Partial<Payment> = {}): Payment {
  return {
    id,
    amount: 1280,
    paymentMethodId: paymentMethod.id,
    title: "取込テスト",
    groupId: group.id,
    paidAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

function backup(overrides: Partial<PaymentExportData> = {}): PaymentExportData {
  return {
    schemaVersion: 1,
    exportedAt: "2026-09-09T15:00:00.000Z",
    payments: [{ ...payment("import-payment"), groupName: group.name, paymentMethodName: paymentMethod.name }],
    groups: [group],
    paymentMethods: [paymentMethod],
    settings,
    ...overrides,
  };
}

describe("payment backup import", () => {
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it("validates schema, entity fields, IDs, timestamps, and references", () => {
    const parsed = parsePaymentBackup(backup());
    expect(parsed).toEqual({ ok: true, data: backup() });

    expect(parsePaymentBackup({ ...backup(), schemaVersion: 2 }).ok).toBe(false);
    expect(parsePaymentBackup({ ...backup(), payments: [{ ...backup().payments[0], amount: 1e3 }] }).ok).toBe(true);
    expect(parsePaymentBackup({ ...backup(), payments: [{ ...backup().payments[0], amount: "1280" }] }).ok).toBe(false);
    expect(parsePaymentBackup({ ...backup(), payments: [{ ...backup().payments[0], groupId: "missing-group" }] }).ok).toBe(false);
    expect(parsePaymentBackup({ ...backup(), payments: [{ ...backup().payments[0], paymentMethodId: "missing-method" }] }).ok).toBe(false);
    expect(parsePaymentBackup({ ...backup(), groups: [group, group] }).ok).toBe(false);
  });

  it("imports all entity types in one transaction and creates sync outbox entries", async () => {
    const changes: string[] = [];
    const unsubscribe = subscribeToLocalDataChanges((change) => changes.push(`${change.kind}:${change.entityId}`));

    const result = await importPaymentBackup(backup());

    expect(result).toEqual({ applied: 4, skipped: 0 });
    expect(await listGroups()).toContainEqual(group);
    expect(await listPaymentMethods(true)).toContainEqual(paymentMethod);
    expect(await listPayments()).toContainEqual(expect.objectContaining({ id: "import-payment", groupId: group.id }));
    expect(await getSettings()).toEqual(settings);
    expect(new Set((await listOutbox()).map((entry) => entry.type))).toEqual(new Set(["GROUP_UPSERT", "PAYMENT_METHOD_UPSERT", "PAYMENT_UPSERT", "SETTINGS_UPSERT"]));
    expect(new Set(changes)).toEqual(new Set(["groups:import-group", "paymentMethods:import-method", "payments:import-payment", "settings:local"]));

    unsubscribe();
  });

  it("keeps a newer local entity and applies a newer logical delete", async () => {
    const local = payment("merge-payment", { amount: 900, updatedAt: "2026-09-09T16:00:00.000Z" });
    await savePayment(local);

    const skipped = await importPaymentBackup(backup({
      payments: [{ ...payment("merge-payment"), amount: 100, groupName: group.name, paymentMethodName: paymentMethod.name }],
      groups: [],
      paymentMethods: [],
      settings: null,
    }));
    expect(skipped).toEqual({ applied: 0, skipped: 1 });
    expect(await getPayment(local.id)).toEqual(local);

    const deleted = payment("merge-payment", { deletedAt: "2026-09-09T17:00:00.000Z", updatedAt: "2026-09-09T17:00:00.000Z" });
    const applied = await importPaymentBackup(backup({ payments: [{ ...deleted, groupName: group.name, paymentMethodName: paymentMethod.name }], groups: [], paymentMethods: [], settings: null }));
    expect(applied).toEqual({ applied: 1, skipped: 0 });
    expect(await listPayments()).not.toContainEqual(expect.objectContaining({ id: local.id }));
    expect(await getPayment(local.id)).toMatchObject({ deletedAt: deleted.deletedAt });
    expect((await listOutbox()).filter((entry) => entry.entityId === local.id).at(-1)?.type).toBe("PAYMENT_DELETE");
  });

  it("rolls back entity writes when an outbox write fails", async () => {
    const rollbackGroup: Group = { ...group, id: "rollback-group" };
    const imported = payment("rollback-payment", { groupId: rollbackGroup.id });
    const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore) {
      if (this.name === "outbox") throw new Error("simulated import outbox failure");
      throw new Error("unexpected object store");
    });

    await expect(importPaymentBackup(backup({ groups: [rollbackGroup], paymentMethods: [], settings: null, payments: [{ ...imported, groupName: rollbackGroup.name, paymentMethodName: null }] }))).rejects.toThrow("simulated import outbox failure");
    add.mockRestore();

    expect(await getPayment(imported.id)).toBeUndefined();
    expect(await getGroup(rollbackGroup.id)).toBeUndefined();
    expect((await listOutbox()).some((entry) => entry.entityId === imported.id)).toBe(false);
  });
});
