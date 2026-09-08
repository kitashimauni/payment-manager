import type { PaymentExportData, PaymentExportRecord } from "./payment-export";
import { defaultPaymentMethodName } from "./default-payment-methods";
import type { Group, Payment, PaymentMethod, UserSettings } from "./types";

type ImportRecord = Record<string, unknown>;

export type PaymentImportParseResult =
  | { ok: true; data: PaymentExportData }
  | { ok: false; error: string };

function isRecord(value: unknown): value is ImportRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: ImportRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function requiredString(record: ImportRecord, key: string, label: string, maxLength: number) {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) throw new Error(`${label}が正しくありません。`);
  return value;
}

function nullableString(record: ImportRecord, key: string, label: string, maxLength: number) {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`${label}が正しくありません。`);
  return value;
}

function nullableId(record: ImportRecord, key: string, label: string, maxLength: number) {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) throw new Error(`${label}が正しくありません。`);
  return value;
}

function safeInteger(record: ImportRecord, key: string, label: string, minimum: number) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error(`${label}が正しくありません。`);
  return value;
}

function timestamp(record: ImportRecord, key: string, label: string) {
  const value = requiredString(record, key, label, 80);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label}が正しくありません。`);
  return value;
}

function nullableTimestamp(record: ImportRecord, key: string, label: string) {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 80 || Number.isNaN(Date.parse(value))) throw new Error(`${label}が正しくありません。`);
  return value;
}

function arrayValue(record: ImportRecord, key: string, label: string) {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${label}が正しくありません。`);
  return value;
}

function uniqueIds(records: Array<{ id: string }>, label: string) {
  const ids = new Set<string>();
  records.forEach((record) => {
    if (ids.has(record.id)) throw new Error(`${label}に同じIDが複数あります。`);
    ids.add(record.id);
  });
  return ids;
}

function parsePayment(value: unknown, index: number): PaymentExportRecord {
  if (!isRecord(value)) throw new Error(`payments[${index}]が正しくありません。`);
  const payment: PaymentExportRecord = {
    id: requiredString(value, "id", `payments[${index}].id`, 200),
    amount: safeInteger(value, "amount", `payments[${index}].amount`, 1),
    paymentMethodId: requiredString(value, "paymentMethodId", `payments[${index}].paymentMethodId`, 200),
    title: nullableString(value, "title", `payments[${index}].title`, 200),
    groupId: nullableId(value, "groupId", `payments[${index}].groupId`, 200),
    paidAt: timestamp(value, "paidAt", `payments[${index}].paidAt`),
    createdAt: timestamp(value, "createdAt", `payments[${index}].createdAt`),
    updatedAt: timestamp(value, "updatedAt", `payments[${index}].updatedAt`),
    deletedAt: nullableTimestamp(value, "deletedAt", `payments[${index}].deletedAt`),
    groupName: nullableString(value, "groupName", `payments[${index}].groupName`, 200),
    paymentMethodName: nullableString(value, "paymentMethodName", `payments[${index}].paymentMethodName`, 200),
  };
  return payment;
}

function parseGroup(value: unknown, index: number): Group {
  if (!isRecord(value)) throw new Error(`groups[${index}]が正しくありません。`);
  const status = value.status;
  if (status !== "active" && status !== "archived") throw new Error(`groups[${index}].statusが正しくありません。`);
  return {
    id: requiredString(value, "id", `groups[${index}].id`, 200),
    name: requiredString(value, "name", `groups[${index}].name`, 80),
    status,
    createdAt: timestamp(value, "createdAt", `groups[${index}].createdAt`),
    updatedAt: timestamp(value, "updatedAt", `groups[${index}].updatedAt`),
    deletedAt: nullableTimestamp(value, "deletedAt", `groups[${index}].deletedAt`),
  };
}

function parsePaymentMethod(value: unknown, index: number): PaymentMethod {
  if (!isRecord(value)) throw new Error(`paymentMethods[${index}]が正しくありません。`);
  const sortOrder = safeInteger(value, "sortOrder", `paymentMethods[${index}].sortOrder`, 0);
  if (typeof value.isActive !== "boolean") throw new Error(`paymentMethods[${index}].isActiveが正しくありません。`);
  return {
    id: requiredString(value, "id", `paymentMethods[${index}].id`, 200),
    name: requiredString(value, "name", `paymentMethods[${index}].name`, 80),
    sortOrder,
    isActive: value.isActive,
    createdAt: timestamp(value, "createdAt", `paymentMethods[${index}].createdAt`),
    updatedAt: timestamp(value, "updatedAt", `paymentMethods[${index}].updatedAt`),
    deletedAt: nullableTimestamp(value, "deletedAt", `paymentMethods[${index}].deletedAt`),
  };
}

function legacyRelationName(value: string | null, label: string) {
  if (value === null || value.trim().length === 0 || value.length > 80) {
    throw new Error(`${label}から参照Entityを復元できません。`);
  }
  return value;
}

function earliestTimestamp(left: string, right: string) {
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function latestTimestamp(left: string, right: string) {
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function parseLegacyEntities(payments: PaymentExportRecord[], exportedAt: string) {
  const groups = new Map<string, Group>();
  const paymentMethods = new Map<string, PaymentMethod>();

  payments.forEach((payment, index) => {
    if (payment.groupId !== null) {
      const name = legacyRelationName(payment.groupName, `payments[${index}].groupName`);
      const current = groups.get(payment.groupId);
      if (current && current.name !== name) {
        throw new Error(`payments[${index}].groupNameが同じgroupIdで一致しません。`);
      }
      groups.set(payment.groupId, {
        id: payment.groupId,
        name,
        status: "active",
        createdAt: current ? earliestTimestamp(current.createdAt, payment.createdAt) : payment.createdAt,
        updatedAt: current ? latestTimestamp(current.updatedAt, payment.updatedAt) : payment.updatedAt,
        deletedAt: null,
      });
    }

    const paymentMethodName = payment.paymentMethodName ?? defaultPaymentMethodName(payment.paymentMethodId) ?? null;
    const name = legacyRelationName(paymentMethodName, `payments[${index}].paymentMethodName`);
    const current = paymentMethods.get(payment.paymentMethodId);
    if (current && current.name !== name) {
      throw new Error(`payments[${index}].paymentMethodNameが同じpaymentMethodIdで一致しません。`);
    }
    paymentMethods.set(payment.paymentMethodId, {
      id: payment.paymentMethodId,
      name,
      sortOrder: current?.sortOrder ?? (defaultPaymentMethodName(payment.paymentMethodId) ? Number(payment.paymentMethodId.slice("default-method-".length)) : paymentMethods.size),
      isActive: true,
      createdAt: current ? earliestTimestamp(current.createdAt, payment.createdAt) : payment.createdAt,
      updatedAt: current ? latestTimestamp(current.updatedAt, payment.updatedAt) : payment.updatedAt,
      deletedAt: null,
    });
  });

  return {
    groups: [...groups.values()],
    paymentMethods: [...paymentMethods.values()],
    settings: null,
    exportedAt,
  };
}

function parseSettings(value: unknown): UserSettings | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || value.id !== "local") throw new Error("settingsが正しくありません。");
  const currentGroupId = value.currentGroupId;
  if (currentGroupId !== null && (typeof currentGroupId !== "string" || currentGroupId.trim().length === 0 || currentGroupId.length > 200)) throw new Error("settings.currentGroupIdが正しくありません。");
  return {
    id: "local",
    currentGroupId,
    createdAt: timestamp(value, "createdAt", "settings.createdAt"),
    updatedAt: timestamp(value, "updatedAt", "settings.updatedAt"),
  };
}

export function parsePaymentBackup(value: unknown): PaymentImportParseResult {
  try {
    if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("対応していないバックアップ形式です。");
    const exportedAt = timestamp(value, "exportedAt", "exportedAt");
    const payments = arrayValue(value, "payments", "payments").map(parsePayment);
    const hasEntitySnapshot = hasOwn(value, "groups") || hasOwn(value, "paymentMethods") || hasOwn(value, "settings");
    if (hasEntitySnapshot && (!hasOwn(value, "groups") || !hasOwn(value, "paymentMethods") || !hasOwn(value, "settings"))) {
      throw new Error("バックアップのEntity情報が不足しています。対応する旧形式の場合はEntity情報をすべて省略してください。");
    }
    const legacyEntities = hasEntitySnapshot ? null : parseLegacyEntities(payments, exportedAt);
    const groups = legacyEntities?.groups ?? arrayValue(value, "groups", "groups").map(parseGroup);
    const paymentMethods = legacyEntities?.paymentMethods ?? arrayValue(value, "paymentMethods", "paymentMethods").map(parsePaymentMethod);
    const settings = legacyEntities?.settings ?? parseSettings(value.settings);
    const groupIds = uniqueIds(groups, "groups");
    const paymentMethodIds = uniqueIds(paymentMethods, "paymentMethods");
    uniqueIds(payments, "payments");

    payments.forEach((payment, index) => {
      if (payment.groupId && !groupIds.has(payment.groupId)) throw new Error(`payments[${index}]のgroupIdが存在しません。`);
      if (!paymentMethodIds.has(payment.paymentMethodId)) throw new Error(`payments[${index}]のpaymentMethodIdが存在しません。`);
    });
    if (settings?.currentGroupId && !groupIds.has(settings.currentGroupId)) throw new Error("settings.currentGroupIdが存在しません。");

    return { ok: true, data: { schemaVersion: 1, exportedAt, payments, groups, paymentMethods, settings } };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "バックアップの内容を確認できません。" };
  }
}
