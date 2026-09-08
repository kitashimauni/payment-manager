import type {
  Group,
  OutboxEntry,
  OutboxOperationType,
  Payment,
  PaymentMethod,
  SyncChange,
  SyncState,
  UserSettings,
} from "./types";
import { defaultPaymentMethods } from "./default-payment-methods";
import { parseSyncPullResponse, parseSyncPushResponse } from "./sync";
import type { PaymentExportData } from "./payment-export";

const DB_NAME = "payment-manager-local";
const DB_VERSION = 1;
const STORE_NAMES = [
  "payments",
  "groups",
  "paymentMethods",
  "settings",
  "outbox",
  "syncState",
] as const;

type StoreName = (typeof STORE_NAMES)[number];
type LocalEntityStoreName = Exclude<StoreName, "outbox" | "syncState">;

export const OUTBOX_CHANGED_EVENT = "payment-manager:outbox-changed";
export const SYNC_STATE_CHANGED_EVENT = "payment-manager:sync-state-changed";
export const LOCAL_DATA_CHANGED_EVENT = "payment-manager:local-data-changed";

export type LocalDataChange = {
  kind: LocalEntityStoreName;
  entityId: string;
  source: "local" | "remote";
};

export function subscribeToOutboxChanges(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;

  const handleChange = () => onChange();
  window.addEventListener(OUTBOX_CHANGED_EVENT, handleChange);
  return () => window.removeEventListener(OUTBOX_CHANGED_EVENT, handleChange);
}

export function subscribeToSyncStateChanges(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;

  const handleChange = () => onChange();
  window.addEventListener(SYNC_STATE_CHANGED_EVENT, handleChange);
  return () => window.removeEventListener(SYNC_STATE_CHANGED_EVENT, handleChange);
}

export function subscribeToLocalDataChanges(onChange: (change: LocalDataChange) => void) {
  if (typeof window === "undefined") return () => undefined;

  const handleChange = (event: Event) => onChange((event as CustomEvent<LocalDataChange>).detail);
  window.addEventListener(LOCAL_DATA_CHANGED_EVENT, handleChange);
  return () => window.removeEventListener(LOCAL_DATA_CHANGED_EVENT, handleChange);
}

function notifyOutboxChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
  }
}

function notifySyncStateChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SYNC_STATE_CHANGED_EVENT));
  }
}

function notifyLocalDataChanged(change: LocalDataChange) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<LocalDataChange>(LOCAL_DATA_CHANGED_EVENT, { detail: change }));
  }
}

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function now() {
  return new Date().toISOString();
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB error"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction error"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

type TransactionCallback<T> = (
  transaction: IDBTransaction,
  complete: (result: T) => void,
  fail: (cause: unknown) => void,
) => void;

/**
 * Keep all requests for a write operation in one IndexedDB transaction.
 * `complete` only resolves after the transaction itself commits, so a failed
 * outbox request also rolls back the entity write.
 */
function runWriteTransaction<T>(storeNames: StoreName[], callback: TransactionCallback<T>) {
  return database().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeNames, "readwrite");
        let result: T;
        let callbackCompleted = false;
        let settled = false;

        const rejectOnce = (cause: unknown) => {
          if (settled) return;
          settled = true;
          reject(cause instanceof Error ? cause : new Error("IndexedDB transaction failed"));
        };

        const fail = (cause: unknown) => {
          rejectOnce(cause);
          try {
            transaction.abort();
          } catch {
            // The transaction may already have aborted itself.
          }
        };

        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          if (!callbackCompleted) {
            reject(new Error("IndexedDB transaction completed without a result"));
            return;
          }
          resolve(result);
        };
        transaction.onerror = () => rejectOnce(transaction.error ?? new Error("IndexedDB transaction error"));
        transaction.onabort = () => rejectOnce(transaction.error ?? new Error("IndexedDB transaction aborted"));

        try {
          callback(
            transaction,
            (nextResult) => {
              result = nextResult;
              callbackCompleted = true;
            },
            fail,
          );
        } catch (cause) {
          fail(cause);
        }
      }),
  );
}

let databasePromise: Promise<IDBDatabase> | undefined;

function database() {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("このブラウザではローカル保存を利用できません。"));
  }
  databasePromise ??= new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of STORE_NAMES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "id" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return databasePromise;
}

async function put<T extends { id: string }>(storeName: StoreName, value: T) {
  const db = await database();
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
  return value;
}

async function get<T>(storeName: StoreName, id: string) {
  const db = await database();
  const transaction = db.transaction(storeName, "readonly");
  return requestResult(transaction.objectStore(storeName).get(id)) as Promise<T | undefined>;
}

async function getAll<T>(storeName: StoreName) {
  const db = await database();
  const transaction = db.transaction(storeName, "readonly");
  return requestResult(transaction.objectStore(storeName).getAll()) as Promise<T[]>;
}

function addOutboxOperation(transaction: IDBTransaction, type: OutboxOperationType, entityId: string, payload: unknown) {
  transaction.objectStore("outbox").add({
    id: uuid(),
    type,
    entityId,
    payload,
    createdAt: now(),
  });
}

function saveWithOutbox<T extends { id: string }>(storeName: LocalEntityStoreName, type: OutboxOperationType, value: T) {
  return runWriteTransaction([storeName, "outbox"], (transaction, complete) => {
    transaction.objectStore(storeName).put(value);
    addOutboxOperation(transaction, type, value.id, value);
    complete(value);
  }).then((saved) => {
    notifyOutboxChanged();
    notifyLocalDataChanged({ kind: storeName, entityId: value.id, source: "local" });
    return saved;
  });
}

export type PaymentImportResult = {
  applied: number;
  skipped: number;
};

function isNewerImport<T extends { updatedAt: string }>(incoming: T, current: T | undefined) {
  return !current || new Date(incoming.updatedAt).getTime() > new Date(current.updatedAt).getTime();
}

export function importPaymentBackup(data: PaymentExportData) {
  const changes: LocalDataChange[] = [];
  return runWriteTransaction<PaymentImportResult>(["groups", "paymentMethods", "payments", "settings", "outbox"], (transaction, complete, fail) => {
    let applied = 0;
    let skipped = 0;
    const requests = [
      ...data.groups.map((group) => ({ storeName: "groups" as const, value: group, upsert: "GROUP_UPSERT" as const, deleted: "GROUP_DELETE" as const })),
      ...data.paymentMethods.map((method) => ({ storeName: "paymentMethods" as const, value: method, upsert: "PAYMENT_METHOD_UPSERT" as const, deleted: undefined })),
      ...data.payments.map((payment) => ({ storeName: "payments" as const, value: payment, upsert: "PAYMENT_UPSERT" as const, deleted: "PAYMENT_DELETE" as const })),
      ...(data.settings ? [{ storeName: "settings" as const, value: data.settings, upsert: "SETTINGS_UPSERT" as const, deleted: undefined }] : []),
    ];

    if (requests.length === 0) {
      complete({ applied, skipped });
      return;
    }

    let pending = requests.length;
    const finishRequest = () => {
      pending -= 1;
      if (pending === 0) complete({ applied, skipped });
    };

    requests.forEach(({ storeName, value, upsert, deleted }) => {
      const request = transaction.objectStore(storeName).get(value.id);
      request.onsuccess = () => {
        try {
          const current = request.result as typeof value | undefined;
          if (!isNewerImport(value, current)) {
            skipped += 1;
            finishRequest();
            return;
          }

          transaction.objectStore(storeName).put(value);
          const operation = "deletedAt" in value && value.deletedAt && deleted ? deleted : upsert;
          addOutboxOperation(transaction, operation, value.id, value);
          changes.push({ kind: storeName, entityId: value.id, source: "local" });
          applied += 1;
          finishRequest();
        } catch (cause) {
          fail(cause);
        }
      };
      request.onerror = () => fail(request.error ?? new Error("Import lookup failed"));
    });
  }).then((result) => {
    if (result.applied > 0) {
      notifyOutboxChanged();
      changes.forEach(notifyLocalDataChanged);
    }
    return result;
  });
}

export async function seedDefaultData() {
  const existing = await getAll<PaymentMethod>("paymentMethods");
  const timestamp = now();
  if (existing.length === 0) {
    await Promise.all(
      defaultPaymentMethods.map((name, index) =>
        put<PaymentMethod>("paymentMethods", {
          id: `default-method-${index}`,
          name,
          sortOrder: index,
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        }),
      ),
    );
  }
  const [settings, syncState] = await Promise.all([get<UserSettings>("settings", "local"), get<SyncState>("syncState", "default")]);
  if (!settings) await put<UserSettings>("settings", { id: "local", currentGroupId: null, createdAt: timestamp, updatedAt: timestamp });
  if (!syncState) {
    await put<SyncState>("syncState", {
      id: "default",
      cursor: null,
      lastSyncedAt: null,
      migrationConfirmed: false,
      syncOwnerUserId: null,
    });
  }
}

export async function listPayments() {
  const payments = (await getAll<Payment>("payments")).filter((payment) => !payment.deletedAt);
  return payments.sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
}

export function getPayment(id: string) {
  return get<Payment>("payments", id);
}

export function savePayment(payment: Payment) {
  return saveWithOutbox("payments", "PAYMENT_UPSERT", payment);
}

export function removePayment(id: string) {
  return runWriteTransaction(["payments", "outbox"], (transaction, complete, fail) => {
    const request = transaction.objectStore("payments").get(id);
    request.onsuccess = () => {
      try {
        const payment = request.result as Payment | undefined;
        if (!payment) {
          complete(undefined);
          return;
        }
        const deleted = { ...payment, deletedAt: now(), updatedAt: now() };
        transaction.objectStore("payments").put(deleted);
        addOutboxOperation(transaction, "PAYMENT_DELETE", id, deleted);
        complete(undefined);
      } catch (cause) {
        fail(cause);
      }
    };
    request.onerror = () => fail(request.error ?? new Error("Payment lookup failed"));
  }).then((removed) => {
    notifyOutboxChanged();
    notifyLocalDataChanged({ kind: "payments", entityId: id, source: "local" });
    return removed;
  });
}

export async function listGroups() {
  const groups = (await getAll<Group>("groups")).filter((group) => !group.deletedAt && group.status === "active");
  return groups.sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export function getGroup(id: string) {
  return get<Group>("groups", id);
}

export function saveGroup(group: Group) {
  return saveWithOutbox("groups", "GROUP_UPSERT", group);
}

export function removeGroup(id: string) {
  return runWriteTransaction<LocalDataChange[]>(["groups", "payments", "settings", "outbox"], (transaction, complete, fail) => {
    const groupRequest = transaction.objectStore("groups").get(id);
    const paymentsRequest = transaction.objectStore("payments").getAll();
    const settingsRequest = transaction.objectStore("settings").get("local");
    let group: Group | undefined;
    let payments: Payment[] = [];
    let settings: UserSettings | undefined;
    const changes: LocalDataChange[] = [];
    let pendingRequests = 3;

    const finishRead = () => {
      pendingRequests -= 1;
      if (pendingRequests > 0) return;

      try {
        if (!group) {
          complete([]);
          return;
        }

        const timestamp = now();
        payments
          .filter((payment) => payment.groupId === id && !payment.deletedAt)
          .forEach((payment) => {
            const ungrouped = { ...payment, groupId: null, updatedAt: timestamp };
            transaction.objectStore("payments").put(ungrouped);
            addOutboxOperation(transaction, "PAYMENT_UPSERT", payment.id, ungrouped);
            changes.push({ kind: "payments", entityId: payment.id, source: "local" });
          });

        const deleted = { ...group, status: "archived" as const, deletedAt: timestamp, updatedAt: timestamp };
        transaction.objectStore("groups").put(deleted);
        addOutboxOperation(transaction, "GROUP_DELETE", id, deleted);
        changes.push({ kind: "groups", entityId: id, source: "local" });

        if (settings?.currentGroupId === id) {
          const updatedSettings = { ...settings, currentGroupId: null, updatedAt: timestamp };
          transaction.objectStore("settings").put(updatedSettings);
          addOutboxOperation(transaction, "SETTINGS_UPSERT", updatedSettings.id, updatedSettings);
          changes.push({ kind: "settings", entityId: updatedSettings.id, source: "local" });
        }
        complete(changes);
      } catch (cause) {
        fail(cause);
      }
    };

    groupRequest.onsuccess = () => {
      group = groupRequest.result as Group | undefined;
      finishRead();
    };
    groupRequest.onerror = () => fail(groupRequest.error ?? new Error("Group lookup failed"));
    paymentsRequest.onsuccess = () => {
      payments = paymentsRequest.result as Payment[];
      finishRead();
    };
    paymentsRequest.onerror = () => fail(paymentsRequest.error ?? new Error("Payment lookup failed"));
    settingsRequest.onsuccess = () => {
      settings = settingsRequest.result as UserSettings | undefined;
      finishRead();
    };
    settingsRequest.onerror = () => fail(settingsRequest.error ?? new Error("Settings lookup failed"));
  }).then((changes) => {
    notifyOutboxChanged();
    changes.forEach(notifyLocalDataChanged);
    return undefined;
  });
}

export async function listPaymentMethods(includeArchived = false) {
  const methods = await getAll<PaymentMethod>("paymentMethods");
  return methods
    .filter((method) => includeArchived || (method.isActive && !method.deletedAt))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getPaymentMethod(id: string) {
  return get<PaymentMethod>("paymentMethods", id);
}

export function savePaymentMethod(method: PaymentMethod) {
  return saveWithOutbox("paymentMethods", "PAYMENT_METHOD_UPSERT", method);
}

export async function getSettings() {
  return get<UserSettings>("settings", "local");
}

export function saveSettings(settings: UserSettings) {
  return saveWithOutbox("settings", "SETTINGS_UPSERT", settings);
}

export function listOutbox() {
  return getAll<OutboxEntry>("outbox");
}

export async function getSyncState() {
  const stored = await get<SyncState>("syncState", "default");
  return {
    id: "default" as const,
    cursor: stored?.cursor ?? null,
    lastSyncedAt: stored?.lastSyncedAt ?? null,
    migrationConfirmed: stored?.migrationConfirmed ?? false,
    syncOwnerUserId: stored?.syncOwnerUserId ?? null,
  };
}

type LocalSyncEntity = Group | PaymentMethod | Payment | UserSettings;

function changeEntityKey(change: SyncChange) {
  switch (change.type) {
    case "GROUP_UPSERT":
    case "GROUP_DELETE":
      return `group:${change.entityId}`;
    case "PAYMENT_METHOD_UPSERT":
      return `payment-method:${change.entityId}`;
    case "PAYMENT_UPSERT":
    case "PAYMENT_DELETE":
      return `payment:${change.entityId}`;
    case "SETTINGS_UPSERT":
      return "settings:local";
  }
}

function outboxEntityKey(entry: OutboxEntry) {
  switch (entry.type) {
    case "GROUP_UPSERT":
    case "GROUP_DELETE":
      return `group:${entry.entityId}`;
    case "PAYMENT_METHOD_UPSERT":
      return `payment-method:${entry.entityId}`;
    case "PAYMENT_UPSERT":
    case "PAYMENT_DELETE":
      return `payment:${entry.entityId}`;
    case "SETTINGS_UPSERT":
      return "settings:local";
  }
}

function remoteEntity(change: SyncChange): { storeName: LocalEntityStoreName; value: LocalSyncEntity } {
  switch (change.type) {
    case "GROUP_UPSERT":
    case "GROUP_DELETE":
      return { storeName: "groups", value: change.payload };
    case "PAYMENT_METHOD_UPSERT":
      return { storeName: "paymentMethods", value: change.payload };
    case "PAYMENT_UPSERT":
    case "PAYMENT_DELETE":
      return { storeName: "payments", value: change.payload };
    case "SETTINGS_UPSERT":
      return { storeName: "settings", value: change.payload };
  }
}

function shouldApplyRemote(local: LocalSyncEntity | undefined, remote: LocalSyncEntity, hasPendingLocalChange: boolean) {
  if (!local) return true;

  const localUpdatedAt = Date.parse(local.updatedAt);
  const remoteUpdatedAt = Date.parse(remote.updatedAt);
  if (remoteUpdatedAt > localUpdatedAt) return true;
  if (remoteUpdatedAt < localUpdatedAt) return false;
  return !hasPendingLocalChange;
}

export function applyRemoteChanges(changes: SyncChange[], nextCursor: string | null, baseSyncState: SyncState) {
  return runWriteTransaction<LocalDataChange[]>(
    ["payments", "groups", "paymentMethods", "settings", "outbox", "syncState"],
    (transaction, complete, fail) => {
      let pendingReads = 6;
      let groups: Group[] = [];
      let paymentMethods: PaymentMethod[] = [];
      let payments: Payment[] = [];
      let settings: UserSettings[] = [];
      let outbox: OutboxEntry[] = [];
      let storedSyncState: SyncState | undefined;

      const finishRead = () => {
        pendingReads -= 1;
        if (pendingReads > 0) return;

        try {
          const localByKey = new Map<string, LocalSyncEntity>();
          groups.forEach((value) => localByKey.set(`group:${value.id}`, value));
          paymentMethods.forEach((value) => localByKey.set(`payment-method:${value.id}`, value));
          payments.forEach((value) => localByKey.set(`payment:${value.id}`, value));
          settings.forEach((value) => localByKey.set("settings:local", value));
          const pendingKeys = new Set(outbox.map(outboxEntityKey));
          const applied: LocalDataChange[] = [];
          const appliedKeys = new Set<string>();

          for (const change of changes) {
            const remote = remoteEntity(change);
            if (!shouldApplyRemote(localByKey.get(changeEntityKey(change)), remote.value, pendingKeys.has(changeEntityKey(change)))) {
              continue;
            }
            transaction.objectStore(remote.storeName).put(remote.value);
            localByKey.set(changeEntityKey(change), remote.value);
            const key = changeEntityKey(change);
            if (!appliedKeys.has(key)) {
              applied.push({ kind: remote.storeName, entityId: change.entityId, source: "remote" });
              appliedKeys.add(key);
            }
          }

          transaction.objectStore("syncState").put({
            ...(storedSyncState ?? baseSyncState),
            id: "default",
            cursor: nextCursor,
            lastSyncedAt: now(),
          } satisfies SyncState);
          complete(applied);
        } catch (cause) {
          fail(cause);
        }
      };

      const readAll = <T>(storeName: StoreName, onSuccess: (values: T[]) => void) => {
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => {
          onSuccess(request.result as T[]);
          finishRead();
        };
        request.onerror = () => fail(request.error ?? new Error(`${storeName} lookup failed`));
      };

      readAll<Group>("groups", (values) => { groups = values; });
      readAll<PaymentMethod>("paymentMethods", (values) => { paymentMethods = values; });
      readAll<Payment>("payments", (values) => { payments = values; });
      readAll<UserSettings>("settings", (values) => { settings = values; });
      readAll<OutboxEntry>("outbox", (values) => { outbox = values; });

      const syncStateRequest = transaction.objectStore("syncState").get("default");
      syncStateRequest.onsuccess = () => {
        storedSyncState = syncStateRequest.result as SyncState | undefined;
        finishRead();
      };
      syncStateRequest.onerror = () => fail(syncStateRequest.error ?? new Error("Sync state lookup failed"));
    },
  ).then((applied) => {
    applied.forEach(notifyLocalDataChanged);
    notifySyncStateChanged();
    return applied.length;
  });
}

export async function confirmSyncMigration(userId: string) {
  if (!userId) throw new Error("同期ユーザーIDがありません。");

  const current = await getSyncState();
  if (current.syncOwnerUserId !== null && current.syncOwnerUserId !== userId) {
    throw new Error("この端末は別のアカウントに紐付いています。");
  }

  const next = {
    ...current,
    migrationConfirmed: true,
    syncOwnerUserId: userId,
  } satisfies SyncState;
  await put<SyncState>("syncState", next);
  notifySyncStateChanged();
  return next;
}

type SyncResult = "offline" | "pending" | "synced";

async function performSync(syncUserId: string): Promise<SyncResult> {
  const outbox = await listOutbox();
  const syncState = await getSyncState();
  if (!syncState.migrationConfirmed || syncState.syncOwnerUserId !== syncUserId) return "pending";

  const response = await fetch("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operations: outbox, cursor: syncState.cursor }),
  });
  if (!response.ok) return "pending";

  const result = parseSyncPushResponse(await response.json());
  const accepted = new Set(result.accepted);
  const acceptedOutbox = outbox.filter((entry) => accepted.has(entry.id));
  if (acceptedOutbox.length > 0) {
    const db = await database();
    const transaction = db.transaction("outbox", "readwrite");
    const store = transaction.objectStore("outbox");
    acceptedOutbox.forEach((entry) => store.delete(entry.id));
    await transactionDone(transaction);
    notifyOutboxChanged();
  }

  if (result.changes.length > 0) {
    await applyRemoteChanges(result.changes, syncState.cursor, syncState);
  }

  let cursor = syncState.cursor;
  let hasMore = true;
  while (hasMore) {
    const endpoint = cursor ? `/api/sync/pull?cursor=${encodeURIComponent(cursor)}` : "/api/sync/pull";
    const pullResponse = await fetch(endpoint);
    if (!pullResponse.ok) return "pending";

    const pullResult = parseSyncPullResponse(await pullResponse.json());
    if (pullResult.hasMore && pullResult.nextCursor === cursor) {
      throw new Error("同期カーソルが進みませんでした。");
    }
    await applyRemoteChanges(pullResult.changes, pullResult.nextCursor, syncState);
    cursor = pullResult.nextCursor;
    hasMore = pullResult.hasMore;
  }

  return acceptedOutbox.length === outbox.length ? "synced" : "pending";
}

let syncInFlight: { userId: string; promise: Promise<SyncResult> } | undefined;

export function trySync(syncUserId?: string | null): Promise<SyncResult> {
  if (typeof window === "undefined" || !navigator.onLine) return Promise.resolve("offline");
  if (!syncUserId) return Promise.resolve("pending");
  if (syncInFlight) return syncInFlight.userId === syncUserId ? syncInFlight.promise : Promise.resolve("pending");

  const promise = performSync(syncUserId).catch(() => "pending" as const).finally(() => {
    if (syncInFlight?.promise === promise) syncInFlight = undefined;
  });
  syncInFlight = { userId: syncUserId, promise };
  return promise;
}

export { uuid, now };
