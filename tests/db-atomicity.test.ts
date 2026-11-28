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
  getSyncState,
  listGroups,
  listPaymentMethods,
  listOutbox,
  listPayments,
  removeGroup,
  removePayment,
  saveGroup,
  savePayment,
  savePaymentMethod,
  addPaymentMethod,
  renamePaymentMethod,
  movePaymentMethod,
  setPaymentMethodActive,
  saveSettings,
  applyRemoteChanges,
  confirmSyncMigration,
  subscribeToOutboxChanges,
  subscribeToLocalDataChanges,
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

  it("serializes renames and moves against the latest method without losing edits", async () => {
    const first = await addPaymentMethod("移動テストA");
    const second = await addPaymentMethod("移動テストB");
    const third = await addPaymentMethod("移動テストC");

    await Promise.all([
      renamePaymentMethod(second.id, "移動テストB変更後"),
      movePaymentMethod(second.id, -1),
    ]);

    let ordered = (await listPaymentMethods()).filter((method) => [first.id, second.id, third.id].includes(method.id));
    expect(ordered.map((method) => method.name)).toEqual(["移動テストB変更後", "移動テストA", "移動テストC"]);
    expect(new Set((await listPaymentMethods(true)).map((method) => method.sortOrder)).size).toBe((await listPaymentMethods(true)).length);

    await movePaymentMethod(second.id, 1);
    await movePaymentMethod(second.id, -1);
    await setPaymentMethodActive(second.id, false);
    await setPaymentMethodActive(second.id, true);
    ordered = (await listPaymentMethods()).filter((method) => [first.id, second.id, third.id].includes(method.id));
    expect(ordered.find((method) => method.id === second.id)?.name).toBe("移動テストB変更後");
    expect(ordered.at(-1)?.id).toBe(second.id);
    expect((await listOutbox()).some((entry) => entry.entityId === second.id && (entry.payload as PaymentMethod).name === "移動テストB変更後")).toBe(true);
  });

  it("uses a deterministic order for legacy methods with the same sortOrder", async () => {
    const timestamp = new Date().toISOString();
    const common = { sortOrder: 50000, isActive: true, createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
    const first = { ...common, id: "tie-method-a", name: "同順A" };
    const second = { ...common, id: "tie-method-b", name: "同順B" };
    await savePaymentMethod(second);
    await savePaymentMethod(first);

    const listed = await listPaymentMethods();
    expect(listed.indexOf(listed.find((method) => method.id === first.id)!)).toBeLessThan(listed.indexOf(listed.find((method) => method.id === second.id)!));
    await movePaymentMethod(second.id, -1);
    const reordered = await listPaymentMethods();
    expect(reordered.indexOf(reordered.find((method) => method.id === second.id)!)).toBeLessThan(reordered.indexOf(reordered.find((method) => method.id === first.id)!));
    expect(new Set(reordered.map((method) => method.sortOrder)).size).toBe(reordered.length);
  });

  it("rolls back every reordered method and outbox entry if the second outbox write fails", async () => {
    const first = await addPaymentMethod("ロールバックA");
    const second = await addPaymentMethod("ロールバックB");
    const before = await listPaymentMethods(true);
    const beforeOutbox = (await listOutbox()).map((entry) => entry.id).sort();
    const originalAdd = IDBObjectStore.prototype.add;
    let writes = 0;
    const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === "outbox" && ++writes === 2) throw new Error("second outbox write failed");
      return originalAdd.call(this, value, key);
    });

    try {
      await expect(movePaymentMethod(second.id, -1)).rejects.toThrow("second outbox write failed");
    } finally {
      add.mockRestore();
    }

    expect(await listPaymentMethods(true)).toEqual(before);
    expect((await listOutbox()).map((entry) => entry.id).sort()).toEqual(beforeOutbox);
    expect((await listPaymentMethods()).find((method) => method.id === first.id)).toBeDefined();
  });

  it("increments timestamps across rapid edits and keeps the most recent name", async () => {
    const created = await addPaymentMethod("連続編集A");
    const renamed = await renamePaymentMethod(created.id, "連続編集B");
    const renamedAgain = await renamePaymentMethod(created.id, "連続編集C");
    expect(Date.parse(renamed.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    expect(Date.parse(renamedAgain.updatedAt)).toBeGreaterThan(Date.parse(renamed.updatedAt));
    expect((await listPaymentMethods()).find((method) => method.id === created.id)?.name).toBe("連続編集C");
  });

  it("does not push local data before migration confirmation", async () => {
    await savePayment(payment("sync-confirmation-gate"));
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(trySync("unconfirmed-user")).resolves.toBe("pending");

    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("keeps the outbox when sync fails", async () => {
    const pendingPayment = payment("sync-failure");
    await savePayment(pendingPayment);
    await confirmSyncMigration("test-user");
    const before = await listOutbox();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    await expect(trySync("test-user")).resolves.toBe("pending");

    expect(await listOutbox()).toEqual(before);
    fetchMock.mockRestore();
  });

  it("notifies subscribers after sync removes accepted outbox entries", async () => {
    const outbox = await listOutbox();
    await confirmSyncMigration("test-user");
    const listener = vi.fn();
    const unsubscribe = subscribeToOutboxChanges(listener);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: outbox.map((entry) => entry.id), changes: [] }), {
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValue(new Response(JSON.stringify({ changes: [], nextCursor: null, hasMore: false }), {
        headers: { "Content-Type": "application/json" },
      }));

    await expect(trySync("test-user")).resolves.toBe("synced");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(await listOutbox()).toEqual([]);
    fetchMock.mockRestore();
    unsubscribe();
  });

  it("coalesces an outbox-triggered sync while the current sync is in flight", async () => {
    await savePayment(payment("sync-single-flight"));
    await confirmSyncMigration("test-user");
    const outbox = await listOutbox();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: outbox.map((entry) => entry.id), changes: [] }), {
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ changes: [], nextCursor: null, hasMore: false }), {
        headers: { "Content-Type": "application/json" },
      }));
    const trigger = vi.fn(() => void trySync("test-user"));
    const unsubscribe = subscribeToOutboxChanges(trigger);

    await expect(trySync("test-user")).resolves.toBe("synced");

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
    unsubscribe();
  });

  it("reruns sync when a local change is created during an in-flight sync", async () => {
    await confirmSyncMigration("test-user");
    let releaseFirstPush!: (response: Response) => void;
    let resolveFirstPushStarted!: () => void;
    const firstPush = new Promise<Response>((resolve) => { releaseFirstPush = resolve; });
    const firstPushStarted = new Promise<void>((resolve) => { resolveFirstPushStarted = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => {
        resolveFirstPushStarted();
        return firstPush;
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({ changes: [], nextCursor: null, hasMore: false }), {
        headers: { "Content-Type": "application/json" },
      }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ accepted: (await listOutbox()).map((entry) => entry.id), changes: [] }), {
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ changes: [], nextCursor: null, hasMore: false }), {
        headers: { "Content-Type": "application/json" },
      }));

    const sync = trySync("test-user");
    await firstPushStarted;
    await savePayment(payment("sync-during-flight"));
    releaseFirstPush(new Response(JSON.stringify({ accepted: [], changes: [] }), {
      headers: { "Content-Type": "application/json" },
    }));

    await expect(sync).resolves.toBe("synced");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await listOutbox()).toEqual([]);
    fetchMock.mockRestore();
  });

  it("applies remote changes without creating outbox entries", async () => {
    const timestamp = "2026-09-07T00:00:00.000Z";
    const remote = payment("remote-apply");
    const remoteChange = {
      type: "PAYMENT_UPSERT" as const,
      entityId: remote.id,
      payload: { ...remote, createdAt: timestamp, updatedAt: timestamp, paidAt: timestamp },
    };
    const listener = vi.fn();
    const unsubscribe = subscribeToLocalDataChanges(listener);

    await applyRemoteChanges([remoteChange], "remote-cursor", await getSyncState());

    expect(await getPayment(remote.id)).toEqual(remoteChange.payload);
    expect((await listOutbox()).some((entry) => entry.entityId === remote.id)).toBe(false);
    expect(await getSyncState()).toMatchObject({ cursor: "remote-cursor", lastSyncedAt: expect.any(String) });
    expect(listener).toHaveBeenCalledWith({ kind: "payments", entityId: remote.id, source: "remote" });
    unsubscribe();
  });

  it("keeps a pending local change when the remote version is older", async () => {
    const local = { ...payment("remote-lww"), updatedAt: "2026-09-07T00:02:00.000Z" };
    const olderRemote = {
      ...local,
      amount: 1,
      updatedAt: "2026-09-07T00:01:00.000Z",
    };
    await savePayment(local);

    await applyRemoteChanges([
      { type: "PAYMENT_UPSERT", entityId: local.id, payload: olderRemote },
    ], "remote-lww-cursor", await getSyncState());

    expect(await getPayment(local.id)).toEqual(local);
    expect((await listOutbox()).some((entry) => entry.entityId === local.id)).toBe(true);
  });

  it("resolves delete/update conflicts by updatedAt without adding remote outbox entries", async () => {
    const localUpdate = {
      ...payment("delete-update-remote-delete"),
      updatedAt: "2026-09-08T00:01:00.000Z",
    };
    const remoteDelete = {
      ...localUpdate,
      updatedAt: "2026-09-08T00:02:00.000Z",
      deletedAt: "2026-09-08T00:02:00.000Z",
    };
    await savePayment(localUpdate);
    const outboxBeforeRemoteDelete = (await listOutbox()).filter((entry) => entry.entityId === localUpdate.id);

    await applyRemoteChanges([
      { type: "PAYMENT_DELETE", entityId: localUpdate.id, payload: remoteDelete },
    ], "delete-wins-cursor", await getSyncState());

    expect(await getPayment(localUpdate.id)).toEqual(remoteDelete);
    expect((await listOutbox()).filter((entry) => entry.entityId === localUpdate.id)).toEqual(outboxBeforeRemoteDelete);

    const localDelete = {
      ...payment("delete-update-local-delete"),
    };
    await savePayment(localDelete);
    await removePayment(localDelete.id);
    const storedLocalDelete = await getPayment(localDelete.id);
    if (!storedLocalDelete) throw new Error("local delete was not stored");
    const outboxBeforeRemoteUpdate = (await listOutbox()).filter((entry) => entry.entityId === localDelete.id);
    expect(outboxBeforeRemoteUpdate.filter((entry) => entry.type === "PAYMENT_DELETE")).toEqual([
      expect.objectContaining({ type: "PAYMENT_DELETE", entityId: localDelete.id }),
    ]);
    const olderRemoteUpdate = {
      ...storedLocalDelete,
      amount: 1,
      updatedAt: new Date(Date.parse(storedLocalDelete.updatedAt) - 1000).toISOString(),
      deletedAt: null,
    };

    await applyRemoteChanges([
      { type: "PAYMENT_UPSERT", entityId: localDelete.id, payload: olderRemoteUpdate },
    ], "update-loses-cursor", await getSyncState());

    expect(await getPayment(localDelete.id)).toEqual(storedLocalDelete);
    expect((await listOutbox()).filter((entry) => entry.entityId === localDelete.id)).toEqual(outboxBeforeRemoteUpdate);
  });

  it("converges to the server state returned for a stale push", async () => {
    const local = { ...payment("stale-push"), amount: 1200, updatedAt: "2026-09-07T00:01:00.000Z" };
    const server = { ...local, amount: 2400, updatedAt: "2026-09-07T00:02:00.000Z" };
    await savePayment(local);
    await confirmSyncMigration("test-user");
    const outbox = await listOutbox();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accepted: outbox.map((entry) => entry.id),
        changes: [{ type: "PAYMENT_UPSERT", entityId: server.id, payload: server }],
      }), { headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ changes: [], nextCursor: null, hasMore: false }), {
        headers: { "Content-Type": "application/json" },
      }));

    await expect(trySync("test-user")).resolves.toBe("synced");

    expect(await getPayment(server.id)).toEqual(server);
    expect(await listOutbox()).toEqual([]);
    fetchMock.mockRestore();
  });

  it("stops pushing when the authenticated account differs from the sync owner", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(trySync("different-user")).resolves.toBe("pending");

    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
