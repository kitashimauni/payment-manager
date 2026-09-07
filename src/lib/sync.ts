import type { SyncChange, SyncPullResponse } from "./types";

export class SyncResponseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncResponseValidationError";
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SyncResponseValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string, maxLength = 255): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new SyncResponseValidationError(`${field} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown, field: string, maxLength = 255): string | null {
  if (value === null) return null;
  return stringValue(value, field, maxLength);
}

function isoDate(value: unknown, field: string): string {
  const parsed = stringValue(value, field, 64);
  if (Number.isNaN(Date.parse(parsed))) {
    throw new SyncResponseValidationError(`${field} must be an ISO date`);
  }
  return parsed;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new SyncResponseValidationError(`${field} must be a positive integer`);
  }
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new SyncResponseValidationError(`${field} must be an integer`);
  }
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new SyncResponseValidationError(`${field} must be a boolean`);
  }
  return value;
}

function timestamps(payload: Record<string, unknown>, field: string) {
  return {
    createdAt: isoDate(payload.createdAt, `${field}.createdAt`),
    updatedAt: isoDate(payload.updatedAt, `${field}.updatedAt`),
    deletedAt: payload.deletedAt === null ? null : isoDate(payload.deletedAt, `${field}.deletedAt`),
  };
}

function paymentChange(type: "PAYMENT_UPSERT" | "PAYMENT_DELETE", entityId: string, value: unknown): SyncChange {
  const payload = record(value, "change.payload");
  if (payload.id !== entityId) throw new SyncResponseValidationError("change.entityId must match payload.id");
  return {
    type,
    entityId,
    payload: {
      ...timestamps(payload, "change.payload"),
      id: stringValue(payload.id, "change.payload.id"),
      amount: positiveInteger(payload.amount, "change.payload.amount"),
      paymentMethodId: stringValue(payload.paymentMethodId, "change.payload.paymentMethodId"),
      title: nullableString(payload.title, "change.payload.title", 200),
      groupId: nullableString(payload.groupId, "change.payload.groupId"),
      paidAt: isoDate(payload.paidAt, "change.payload.paidAt"),
    },
  };
}

function groupChange(type: "GROUP_UPSERT" | "GROUP_DELETE", entityId: string, value: unknown): SyncChange {
  const payload = record(value, "change.payload");
  if (payload.id !== entityId) throw new SyncResponseValidationError("change.entityId must match payload.id");
  const status = payload.status;
  if (status !== "active" && status !== "archived") {
    throw new SyncResponseValidationError("change.payload.status is invalid");
  }
  const name = stringValue(payload.name, "change.payload.name", 80);
  if (name.trim().length === 0) throw new SyncResponseValidationError("change.payload.name must not be blank");
  return {
    type,
    entityId,
    payload: {
      ...timestamps(payload, "change.payload"),
      id: stringValue(payload.id, "change.payload.id"),
      name,
      status,
    },
  };
}

function paymentMethodChange(entityId: string, value: unknown): SyncChange {
  const payload = record(value, "change.payload");
  if (payload.id !== entityId) throw new SyncResponseValidationError("change.entityId must match payload.id");
  const name = stringValue(payload.name, "change.payload.name", 80);
  if (name.trim().length === 0) throw new SyncResponseValidationError("change.payload.name must not be blank");
  return {
    type: "PAYMENT_METHOD_UPSERT",
    entityId,
    payload: {
      ...timestamps(payload, "change.payload"),
      id: stringValue(payload.id, "change.payload.id"),
      name,
      sortOrder: integer(payload.sortOrder, "change.payload.sortOrder"),
      isActive: booleanValue(payload.isActive, "change.payload.isActive"),
    },
  };
}

function settingsChange(entityId: string, value: unknown): SyncChange {
  if (entityId !== "local") throw new SyncResponseValidationError("settings entityId must be local");
  const payload = record(value, "change.payload");
  if (payload.id !== "local") throw new SyncResponseValidationError("settings payload.id must be local");
  return {
    type: "SETTINGS_UPSERT",
    entityId,
    payload: {
      id: "local",
      currentGroupId: nullableString(payload.currentGroupId, "change.payload.currentGroupId"),
      createdAt: isoDate(payload.createdAt, "change.payload.createdAt"),
      updatedAt: isoDate(payload.updatedAt, "change.payload.updatedAt"),
    },
  };
}

function parseChange(value: unknown): SyncChange {
  const change = record(value, "change");
  const type = stringValue(change.type, "change.type");
  const entityId = stringValue(change.entityId, "change.entityId");
  switch (type) {
    case "GROUP_UPSERT":
    case "GROUP_DELETE":
      return groupChange(type, entityId, change.payload);
    case "PAYMENT_METHOD_UPSERT":
      return paymentMethodChange(entityId, change.payload);
    case "PAYMENT_UPSERT":
    case "PAYMENT_DELETE":
      return paymentChange(type, entityId, change.payload);
    case "SETTINGS_UPSERT":
      return settingsChange(entityId, change.payload);
    default:
      throw new SyncResponseValidationError("change.type is not supported");
  }
}

export function parseSyncPullResponse(value: unknown): SyncPullResponse {
  const body = record(value, "sync pull response");
  if (!Array.isArray(body.changes)) throw new SyncResponseValidationError("changes must be an array");
  if (body.nextCursor !== null && typeof body.nextCursor !== "string") {
    throw new SyncResponseValidationError("nextCursor must be a string or null");
  }
  if (typeof body.nextCursor === "string" && (body.nextCursor.length === 0 || body.nextCursor.length > 512)) {
    throw new SyncResponseValidationError("nextCursor is invalid");
  }
  if (typeof body.hasMore !== "boolean") throw new SyncResponseValidationError("hasMore must be a boolean");
  return {
    changes: body.changes.map(parseChange),
    nextCursor: body.nextCursor,
    hasMore: body.hasMore,
  };
}
