import type {
  GroupPushPayload,
  PaymentMethodPushPayload,
  PaymentPushPayload,
  SettingsPushPayload,
} from "./push";

export const syncEntityKinds = ["groups", "paymentMethods", "payments", "settings"] as const;
export type SyncEntityKind = (typeof syncEntityKinds)[number];

const entityKindOrder = new Map<SyncEntityKind, number>(syncEntityKinds.map((kind, index) => [kind, index]));

export type PullCursor = {
  version: 1;
  updatedAt: string;
  kind: SyncEntityKind;
  id: string;
};

export type SyncPosition = {
  updatedAt: Date;
  kind: SyncEntityKind;
  id: string;
};

export type PullChange =
  | { type: "GROUP_UPSERT" | "GROUP_DELETE"; entityId: string; payload: GroupPushPayload }
  | { type: "PAYMENT_METHOD_UPSERT"; entityId: string; payload: PaymentMethodPushPayload }
  | { type: "PAYMENT_UPSERT" | "PAYMENT_DELETE"; entityId: string; payload: PaymentPushPayload }
  | { type: "SETTINGS_UPSERT"; entityId: "local"; payload: SettingsPushPayload };

export class PullValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PullValidationError";
  }
}

function isSyncEntityKind(value: unknown): value is SyncEntityKind {
  return typeof value === "string" && syncEntityKinds.includes(value as SyncEntityKind);
}

function compareStrings(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareSyncPositions(left: SyncPosition, right: SyncPosition) {
  const updatedAtComparison = left.updatedAt.getTime() - right.updatedAt.getTime();
  if (updatedAtComparison !== 0) return updatedAtComparison;

  const kindComparison = entityKindOrder.get(left.kind)! - entityKindOrder.get(right.kind)!;
  if (kindComparison !== 0) return kindComparison;
  return compareStrings(left.id, right.id);
}

export function isAfterCursor(position: SyncPosition, cursor: PullCursor | null) {
  if (!cursor) return true;
  return compareSyncPositions(position, {
    updatedAt: new Date(cursor.updatedAt),
    kind: cursor.kind,
    id: cursor.id,
  }) > 0;
}

export function encodeCursor(position: SyncPosition | PullCursor): string {
  const cursor: PullCursor = {
    version: 1,
    updatedAt: position.updatedAt instanceof Date ? position.updatedAt.toISOString() : position.updatedAt,
    kind: position.kind,
    id: position.id,
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value: string | null): PullCursor | null {
  if (!value) return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PullValidationError("cursor must be a valid opaque cursor");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new PullValidationError("cursor must be a valid opaque cursor");
  }

  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new PullValidationError("cursor must be a valid opaque cursor");
  }

  const cursor = decoded as Record<string, unknown>;
  if (cursor.version !== 1 || typeof cursor.updatedAt !== "string" || !isSyncEntityKind(cursor.kind) || typeof cursor.id !== "string") {
    throw new PullValidationError("cursor must be a valid opaque cursor");
  }

  const updatedAt = new Date(cursor.updatedAt);
  if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== cursor.updatedAt) {
    throw new PullValidationError("cursor must contain a canonical ISO timestamp");
  }
  if (cursor.id.length === 0 || cursor.id.length > 255) {
    throw new PullValidationError("cursor must contain a valid entity ID");
  }

  return {
    version: 1,
    updatedAt: cursor.updatedAt,
    kind: cursor.kind,
    id: cursor.id,
  };
}
