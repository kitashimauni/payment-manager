import type {
  Group,
  OutboxEntry,
  OutboxOperationType,
  Payment,
  PaymentMethod,
  SyncState,
  UserSettings,
} from "./types";

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

const defaultPaymentMethods = ["現金", "Suica", "PayPay", "Visa", "Mastercard", "QUICPay"];

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

export async function savePayment(payment: Payment) {
  await put("payments", payment);
  await enqueue("PAYMENT_UPSERT", payment.id, payment);
  return payment;
}

export async function removePayment(id: string) {
  const payment = await getPayment(id);
  if (!payment) return;
  const deleted = { ...payment, deletedAt: now(), updatedAt: now() };
  await put("payments", deleted);
  await enqueue("PAYMENT_DELETE", id, deleted);
}

export async function listGroups() {
  const groups = (await getAll<Group>("groups")).filter((group) => !group.deletedAt && group.status === "active");
  return groups.sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export function getGroup(id: string) {
  return get<Group>("groups", id);
}

export async function saveGroup(group: Group) {
  await put("groups", group);
  await enqueue("GROUP_UPSERT", group.id, group);
  return group;
}

export async function removeGroup(id: string) {
  const group = await getGroup(id);
  if (!group) return;
  const timestamp = now();
  const [payments, settings] = await Promise.all([getAll<Payment>("payments"), getSettings()]);
  await Promise.all(
    payments
      .filter((payment) => payment.groupId === id && !payment.deletedAt)
      .map((payment) =>
        savePayment({ ...payment, groupId: null, updatedAt: timestamp }),
      ),
  );
  const deleted = { ...group, status: "archived" as const, deletedAt: timestamp, updatedAt: timestamp };
  await put("groups", deleted);
  await enqueue("GROUP_DELETE", id, deleted);
  if (settings?.currentGroupId === id) {
    await saveSettings({ ...settings, currentGroupId: null, updatedAt: timestamp });
  }
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

export async function savePaymentMethod(method: PaymentMethod) {
  await put("paymentMethods", method);
  await enqueue("PAYMENT_METHOD_UPSERT", method.id, method);
  return method;
}

export async function getSettings() {
  return get<UserSettings>("settings", "local");
}

export async function saveSettings(settings: UserSettings) {
  await put("settings", settings);
  await enqueue("SETTINGS_UPSERT", settings.id, settings);
  return settings;
}

export function listOutbox() {
  return getAll<OutboxEntry>("outbox");
}

async function enqueue(type: OutboxOperationType, entityId: string, payload: unknown) {
  await put<OutboxEntry>("outbox", {
    id: uuid(),
    type,
    entityId,
    payload,
    createdAt: now(),
  });
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
