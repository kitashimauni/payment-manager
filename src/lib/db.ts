import type {
  Group,
  OutboxEntry,
  OutboxOperationType,
  Payment,
  PaymentMethod,
  SyncState,
  UserSettings,
} from "./types";
import { defaultPaymentMethods } from "./default-payment-methods";

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

export const OUTBOX_CHANGED_EVENT = "payment-manager:outbox-changed";

export function subscribeToOutboxChanges(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;

  const handleChange = () => onChange();
  window.addEventListener(OUTBOX_CHANGED_EVENT, handleChange);
  return () => window.removeEventListener(OUTBOX_CHANGED_EVENT, handleChange);
}

function notifyOutboxChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
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

function saveWithOutbox<T extends { id: string }>(storeName: StoreName, type: OutboxOperationType, value: T) {
  return runWriteTransaction([storeName, "outbox"], (transaction, complete) => {
    transaction.objectStore(storeName).put(value);
    addOutboxOperation(transaction, type, value.id, value);
    complete(value);
  }).then((saved) => {
    notifyOutboxChanged();
    return saved;
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
  if (!syncState) await put<SyncState>("syncState", { id: "default", cursor: null, lastSyncedAt: null });
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
  return runWriteTransaction(["groups", "payments", "settings", "outbox"], (transaction, complete, fail) => {
    const groupRequest = transaction.objectStore("groups").get(id);
    const paymentsRequest = transaction.objectStore("payments").getAll();
    const settingsRequest = transaction.objectStore("settings").get("local");
    let group: Group | undefined;
    let payments: Payment[] = [];
    let settings: UserSettings | undefined;
    let pendingRequests = 3;

    const finishRead = () => {
      pendingRequests -= 1;
      if (pendingRequests > 0) return;

      try {
        if (!group) {
          complete(undefined);
          return;
        }

        const timestamp = now();
        payments
          .filter((payment) => payment.groupId === id && !payment.deletedAt)
          .forEach((payment) => {
            const ungrouped = { ...payment, groupId: null, updatedAt: timestamp };
            transaction.objectStore("payments").put(ungrouped);
            addOutboxOperation(transaction, "PAYMENT_UPSERT", payment.id, ungrouped);
          });

        const deleted = { ...group, status: "archived" as const, deletedAt: timestamp, updatedAt: timestamp };
        transaction.objectStore("groups").put(deleted);
        addOutboxOperation(transaction, "GROUP_DELETE", id, deleted);

        if (settings?.currentGroupId === id) {
          const updatedSettings = { ...settings, currentGroupId: null, updatedAt: timestamp };
          transaction.objectStore("settings").put(updatedSettings);
          addOutboxOperation(transaction, "SETTINGS_UPSERT", updatedSettings.id, updatedSettings);
        }
        complete(undefined);
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
  }).then((removed) => {
    notifyOutboxChanged();
    return removed;
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
  return (await get<SyncState>("syncState", "default")) ?? {
    id: "default" as const,
    cursor: null,
    lastSyncedAt: null,
  };
}

export async function trySync() {
  if (typeof window === "undefined" || !navigator.onLine) return "offline" as const;

  const outbox = await listOutbox();
  const syncState = await getSyncState();
  try {
    const response = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations: outbox, cursor: syncState.cursor }),
    });
    if (!response.ok) return "pending" as const;
    const result = (await response.json()) as { accepted?: string[]; changes?: unknown[]; nextCursor?: string | null };
    const accepted = new Set(result.accepted ?? []);
    if (accepted.size > 0) {
      const db = await database();
      const transaction = db.transaction("outbox", "readwrite");
      const store = transaction.objectStore("outbox");
      outbox.filter((entry) => accepted.has(entry.id)).forEach((entry) => store.delete(entry.id));
      await transactionDone(transaction);
      notifyOutboxChanged();
    }
    if (result.nextCursor !== undefined) {
      await put<SyncState>("syncState", { id: "default", cursor: result.nextCursor ?? null, lastSyncedAt: now() });
    }
    return accepted.size === outbox.length ? ("synced" as const) : ("pending" as const);
  } catch {
    return "pending" as const;
  }
}

export { uuid, now };
