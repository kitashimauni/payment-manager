export type EntityStatus = "active" | "archived";

export type Payment = {
  id: string;
  amount: number;
  paymentMethodId: string;
  title: string | null;
  groupId: string | null;
  paidAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type PaymentMethod = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type Group = {
  id: string;
  name: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type UserSettings = {
  id: "local";
  currentGroupId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OutboxOperationType =
  | "PAYMENT_UPSERT"
  | "PAYMENT_DELETE"
  | "GROUP_UPSERT"
  | "GROUP_DELETE"
  | "PAYMENT_METHOD_UPSERT"
  | "SETTINGS_UPSERT";

export type OutboxEntry = {
  id: string;
  type: OutboxOperationType;
  entityId: string;
  payload: unknown;
  createdAt: string;
};

export type SyncChange =
  | { type: "GROUP_UPSERT" | "GROUP_DELETE"; entityId: string; payload: Group }
  | { type: "PAYMENT_METHOD_UPSERT"; entityId: string; payload: PaymentMethod }
  | { type: "PAYMENT_UPSERT" | "PAYMENT_DELETE"; entityId: string; payload: Payment }
  | { type: "SETTINGS_UPSERT"; entityId: "local"; payload: UserSettings };

export type SyncPullResponse = {
  changes: SyncChange[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type SyncPushResponse = {
  accepted: string[];
  changes: SyncChange[];
};

export type SyncState = {
  id: "default";
  cursor: string | null;
  lastSyncedAt: string | null;
  migrationConfirmed: boolean;
  syncOwnerUserId: string | null;
};

export type PaymentWithRelations = Payment & {
  paymentMethod?: PaymentMethod;
  group?: Group;
};
