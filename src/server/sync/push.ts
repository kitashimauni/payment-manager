import type { OutboxOperationType } from "@/lib/types";

const operationTypes = [
  "PAYMENT_UPSERT",
  "PAYMENT_DELETE",
  "GROUP_UPSERT",
  "GROUP_DELETE",
  "PAYMENT_METHOD_UPSERT",
  "SETTINGS_UPSERT",
] as const satisfies readonly OutboxOperationType[];

type TimestampPayload = {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type PaymentPushPayload = TimestampPayload & {
  id: string;
  amount: number;
  paymentMethodId: string;
  title: string | null;
  groupId: string | null;
  paidAt: string;
};

export type GroupPushPayload = TimestampPayload & {
  id: string;
  name: string;
  status: "active" | "archived";
};

export type PaymentMethodPushPayload = TimestampPayload & {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type SettingsPushPayload = {
  id: "local";
  currentGroupId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PushPayload =
  | PaymentPushPayload
  | GroupPushPayload
  | PaymentMethodPushPayload
  | SettingsPushPayload;

type PushOperationBase<T extends OutboxOperationType, P extends PushPayload> = {
  id: string;
  type: T;
  entityId: string;
  payload: P;
  createdAt: string;
};

export type PushOperation =
  | PushOperationBase<"PAYMENT_UPSERT" | "PAYMENT_DELETE", PaymentPushPayload>
  | PushOperationBase<"GROUP_UPSERT" | "GROUP_DELETE", GroupPushPayload>
  | PushOperationBase<"PAYMENT_METHOD_UPSERT", PaymentMethodPushPayload>
  | PushOperationBase<"SETTINGS_UPSERT", SettingsPushPayload>;

export class PushValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushValidationError";
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PushValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new PushValidationError(`${field} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function nullableString(value: unknown, field: string, maxLength = 200): string | null {
  if (value === null) return null;
  return stringValue(value, field, maxLength);
}

function isoDate(value: unknown, field: string): string {
  const parsed = stringValue(value, field, 64);
  if (Number.isNaN(Date.parse(parsed))) {
    throw new PushValidationError(`${field} must be an ISO date`);
  }
  return parsed;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new PushValidationError(`${field} must be a positive integer`);
  }
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new PushValidationError(`${field} must be an integer`);
  }
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new PushValidationError(`${field} must be a boolean`);
  }
  return value;
}

function timestampPayload(value: unknown, field: string): TimestampPayload {
  const payload = record(value, field);
  return {
    createdAt: isoDate(payload.createdAt, `${field}.createdAt`),
    updatedAt: isoDate(payload.updatedAt, `${field}.updatedAt`),
    deletedAt: payload.deletedAt === null ? null : isoDate(payload.deletedAt, `${field}.deletedAt`),
  };
}

function paymentPayload(value: unknown): PaymentPushPayload {
  const payload = record(value, "payload");
  return {
    ...timestampPayload(payload, "payload"),
    id: stringValue(payload.id, "payload.id"),
    amount: positiveInteger(payload.amount, "payload.amount"),
    paymentMethodId: stringValue(payload.paymentMethodId, "payload.paymentMethodId"),
    title: nullableString(payload.title, "payload.title"),
    groupId: nullableString(payload.groupId, "payload.groupId"),
    paidAt: isoDate(payload.paidAt, "payload.paidAt"),
  };
}

function groupPayload(value: unknown): GroupPushPayload {
  const payload = record(value, "payload");
  const status = payload.status;
  if (status !== "active" && status !== "archived") {
    throw new PushValidationError("payload.status must be active or archived");
  }
  const result = {
    ...timestampPayload(payload, "payload"),
    id: stringValue(payload.id, "payload.id"),
    name: stringValue(payload.name, "payload.name", 80),
    status,
  } satisfies GroupPushPayload;
  if (result.name.trim().length === 0) {
    throw new PushValidationError("payload.name must not be blank");
  }
  return result;
}

function paymentMethodPayload(value: unknown): PaymentMethodPushPayload {
  const payload = record(value, "payload");
  const result = {
    ...timestampPayload(payload, "payload"),
    id: stringValue(payload.id, "payload.id"),
    name: stringValue(payload.name, "payload.name", 80),
    sortOrder: integer(payload.sortOrder, "payload.sortOrder"),
    isActive: booleanValue(payload.isActive, "payload.isActive"),
  } satisfies PaymentMethodPushPayload;
  if (result.name.trim().length === 0) {
    throw new PushValidationError("payload.name must not be blank");
  }
  return result;
}

function settingsPayload(value: unknown): SettingsPushPayload {
  const payload = record(value, "payload");
  const id = payload.id;
  if (id !== "local") {
    throw new PushValidationError("payload.id must be local");
  }
  return {
    id,
    currentGroupId: nullableString(payload.currentGroupId, "payload.currentGroupId"),
    createdAt: isoDate(payload.createdAt, "payload.createdAt"),
    updatedAt: isoDate(payload.updatedAt, "payload.updatedAt"),
  };
}

function operationType(value: unknown): OutboxOperationType {
  if (typeof value !== "string" || !operationTypes.includes(value as OutboxOperationType)) {
    throw new PushValidationError("operation.type is not supported");
  }
  return value as OutboxOperationType;
}

function parseOperation(value: unknown): PushOperation {
  const operation = record(value, "operation");
  const type = operationType(operation.type);
  const id = stringValue(operation.id, "operation.id");
  const entityId = stringValue(operation.entityId, "operation.entityId");
  const createdAt = isoDate(operation.createdAt, "operation.createdAt");

  const assertEntityId = (payload: PushPayload) => {
    if (entityId !== payload.id) {
      throw new PushValidationError("operation.entityId must match payload.id");
    }
  };

  switch (type) {
    case "PAYMENT_UPSERT":
    case "PAYMENT_DELETE":
      {
        const payload = paymentPayload(operation.payload);
        assertEntityId(payload);
        return { id, type, entityId, payload, createdAt };
      }
    case "GROUP_UPSERT":
    case "GROUP_DELETE":
      {
        const payload = groupPayload(operation.payload);
        assertEntityId(payload);
        return { id, type, entityId, payload, createdAt };
      }
    case "PAYMENT_METHOD_UPSERT":
      {
        const payload = paymentMethodPayload(operation.payload);
        assertEntityId(payload);
        return { id, type, entityId, payload, createdAt };
      }
    case "SETTINGS_UPSERT":
      {
        const payload = settingsPayload(operation.payload);
        assertEntityId(payload);
        return { id, type, entityId, payload, createdAt };
      }
  }
}

export function parsePushRequest(value: unknown): { operations: PushOperation[] } {
  const body = record(value, "request");
  if (!Array.isArray(body.operations)) {
    throw new PushValidationError("request.operations must be an array");
  }

  const ids = new Set<string>();
  const operations = body.operations.map((value) => {
    const operation = parseOperation(value);
    if (ids.has(operation.id)) {
      throw new PushValidationError("request.operations must not contain duplicate IDs");
    }
    ids.add(operation.id);
    return operation;
  });

  return { operations };
}
