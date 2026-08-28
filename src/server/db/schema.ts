import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestampColumns = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
};

export const groupStatus = pgEnum("group_status", ["active", "archived"]);

/**
 * User IDs are text because the authentication provider has not been selected
 * yet. This keeps the schema compatible with OAuth subject IDs as well as
 * UUID-based providers. Entity IDs are scoped by user in the tables below so
 * deterministic local IDs (such as the seeded payment-method IDs) are safe to
 * use for more than one account.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  ...timestampColumns,
});

export const groups = pgTable(
  "groups",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    status: groupStatus("status").notNull().default("active"),
    ...timestampColumns,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "groups_user_id_users_id_fk",
    }).onDelete("cascade"),
    index("groups_user_updated_at_idx").on(table.userId, table.updatedAt, table.id),
    check("groups_name_not_blank", sql`length(btrim(${table.name})) > 0`),
  ],
);

export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestampColumns,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "payment_methods_user_id_users_id_fk",
    }).onDelete("cascade"),
    index("payment_methods_user_updated_at_idx").on(table.userId, table.updatedAt, table.id),
    check("payment_methods_name_not_blank", sql`length(btrim(${table.name})) > 0`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    amount: integer("amount").notNull(),
    paymentMethodId: text("payment_method_id").notNull(),
    title: varchar("title", { length: 200 }),
    groupId: text("group_id"),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }).notNull(),
    ...timestampColumns,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "payments_user_id_users_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.paymentMethodId],
      foreignColumns: [paymentMethods.userId, paymentMethods.id],
      name: "payments_user_payment_method_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.userId, table.groupId],
      foreignColumns: [groups.userId, groups.id],
      name: "payments_user_group_fk",
    }).onDelete("restrict"),
    index("payments_user_paid_at_idx").on(table.userId, table.paidAt, table.id),
    index("payments_user_updated_at_idx").on(table.userId, table.updatedAt, table.id),
    index("payments_group_paid_at_idx").on(table.groupId, table.paidAt),
    check("payments_amount_positive", sql`${table.amount} > 0`),
  ],
);

export const userSettings = pgTable(
  "user_settings",
  {
    userId: text("user_id").notNull(),
    currentGroupId: text("current_group_id"),
    ...timestampColumns,
  },
  (table) => [
    primaryKey({ columns: [table.userId] }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "user_settings_user_id_users_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.currentGroupId],
      foreignColumns: [groups.userId, groups.id],
      name: "user_settings_user_group_fk",
    }).onDelete("restrict"),
    index("user_settings_user_updated_at_idx").on(table.userId, table.updatedAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type NewPaymentMethod = typeof paymentMethods.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;
