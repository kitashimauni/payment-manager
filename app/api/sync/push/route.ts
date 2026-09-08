import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth, authEnabled } from "@/auth";
import { defaultPaymentMethodName } from "@/lib/default-payment-methods";
import { db } from "@/server/db/client";
import {
  groups,
  payments,
  paymentMethods,
  userSettings,
  users,
} from "@/server/db/schema";
import {
  parsePushRequest,
  PushValidationError,
  type GroupPushPayload,
  type PaymentMethodPushPayload,
  type PaymentPushPayload,
  type PushOperation,
  type SettingsPushPayload,
} from "@/server/sync/push";
import type { PullChange } from "@/server/sync/pull";

class PushRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushRejectedError";
  }
}

function date(value: string) {
  return new Date(value);
}

function nextSyncVersion() {
  return sql`nextval('sync_change_version_seq')`;
}

function groupChange(row: typeof groups.$inferSelect): PullChange {
  return {
    type: row.deletedAt ? "GROUP_DELETE" : "GROUP_UPSERT",
    entityId: row.id,
    payload: {
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    },
  };
}

function paymentMethodChange(row: typeof paymentMethods.$inferSelect): PullChange {
  return {
    type: "PAYMENT_METHOD_UPSERT",
    entityId: row.id,
    payload: {
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    },
  };
}

function paymentChange(row: typeof payments.$inferSelect): PullChange {
  return {
    type: row.deletedAt ? "PAYMENT_DELETE" : "PAYMENT_UPSERT",
    entityId: row.id,
    payload: {
      id: row.id,
      amount: row.amount,
      paymentMethodId: row.paymentMethodId,
      title: row.title,
      groupId: row.groupId,
      paidAt: row.paidAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    },
  };
}

function settingsChange(row: typeof userSettings.$inferSelect): PullChange {
  return {
    type: "SETTINGS_UPSERT",
    entityId: "local",
    payload: {
      id: "local",
      currentGroupId: row.currentGroupId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}

function orderedOperations(operations: PushOperation[]) {
  const order = [
    "GROUP_UPSERT",
    "GROUP_DELETE",
    "PAYMENT_METHOD_UPSERT",
    "PAYMENT_UPSERT",
    "PAYMENT_DELETE",
    "SETTINGS_UPSERT",
  ] as const;
  return order.flatMap((type) => operations.filter((operation) => operation.type === type));
}

export async function POST(request: Request) {
  const database = db;
  if (!authEnabled || !database) {
    return NextResponse.json(
      { accepted: [], reason: "server-sync-not-configured" },
      { status: 503 },
    );
  }

  let session;
  try {
    session = await auth();
  } catch {
    return NextResponse.json(
      { accepted: [], reason: "authentication-unavailable" },
      { status: 503 },
    );
  }

  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { accepted: [], reason: "authentication-required" },
      { status: 401 },
    );
  }

  let parsed: ReturnType<typeof parsePushRequest>;
  try {
    parsed = parsePushRequest(await request.json());
  } catch (error) {
    const message = error instanceof PushValidationError ? error.message : "request body must be valid JSON";
    return NextResponse.json({ accepted: [], error: "invalid-payload", message }, { status: 400 });
  }

  const staleChanges: PullChange[] = [];

  try {
    await database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);

      const [user] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        throw new PushRejectedError("authenticated user does not exist");
      }

      const assertGroupOwned = async (groupId: string) => {
        const [group] = await transaction
          .select({ id: groups.id })
          .from(groups)
          .where(and(eq(groups.userId, userId), eq(groups.id, groupId)))
          .limit(1);
        if (!group) throw new PushRejectedError("group is not owned by the authenticated user");
      };

      const assertPaymentMethodOwned = async (paymentMethodId: string) => {
        let [method] = await transaction
          .select({ id: paymentMethods.id })
          .from(paymentMethods)
          .where(and(eq(paymentMethods.userId, userId), eq(paymentMethods.id, paymentMethodId)))
          .limit(1);

        if (!method) {
          const defaultName = defaultPaymentMethodName(paymentMethodId);
          if (defaultName) {
            const timestamp = new Date();
            await transaction
              .insert(paymentMethods)
              .values({
                id: paymentMethodId,
                userId,
                name: defaultName,
                sortOrder: Number(paymentMethodId.slice("default-method-".length)),
                isActive: true,
                createdAt: timestamp,
                updatedAt: timestamp,
                deletedAt: null,
              })
              .onConflictDoNothing({ target: [paymentMethods.userId, paymentMethods.id] });
            [method] = await transaction
              .select({ id: paymentMethods.id })
              .from(paymentMethods)
              .where(and(eq(paymentMethods.userId, userId), eq(paymentMethods.id, paymentMethodId)))
              .limit(1);
          }
        }

        if (!method) throw new PushRejectedError("payment method is not owned by the authenticated user");
      };

      const saveGroup = async (payload: GroupPushPayload) => {
        const saved = await transaction
          .insert(groups)
          .values({
            id: payload.id,
            userId,
            name: payload.name,
            status: payload.status,
            createdAt: date(payload.createdAt),
            updatedAt: date(payload.updatedAt),
            deletedAt: payload.deletedAt === null ? null : date(payload.deletedAt),
          })
          .onConflictDoUpdate({
            target: [groups.userId, groups.id],
            where: sql`${groups.updatedAt} <= excluded.updated_at`,
            set: {
              name: payload.name,
              status: payload.status,
              updatedAt: date(payload.updatedAt),
              deletedAt: payload.deletedAt === null ? null : date(payload.deletedAt),
              syncVersion: nextSyncVersion(),
            },
          })
          .returning({ id: groups.id });
        if (saved.length === 0) {
          const [current] = await transaction
            .select()
            .from(groups)
            .where(and(eq(groups.userId, userId), eq(groups.id, payload.id)))
            .limit(1);
          if (!current) throw new Error("group conflict row disappeared");
          staleChanges.push(groupChange(current));
        }
      };

      const savePaymentMethod = async (payload: PaymentMethodPushPayload) => {
        const saved = await transaction
          .insert(paymentMethods)
          .values({
            id: payload.id,
            userId,
            name: payload.name,
            sortOrder: payload.sortOrder,
            isActive: payload.isActive,
            createdAt: date(payload.createdAt),
            updatedAt: date(payload.updatedAt),
            deletedAt: payload.deletedAt === null ? null : date(payload.deletedAt),
          })
          .onConflictDoUpdate({
            target: [paymentMethods.userId, paymentMethods.id],
            where: sql`${paymentMethods.updatedAt} <= excluded.updated_at`,
            set: {
              name: payload.name,
              sortOrder: payload.sortOrder,
              isActive: payload.isActive,
              updatedAt: date(payload.updatedAt),
              deletedAt: payload.deletedAt === null ? null : date(payload.deletedAt),
              syncVersion: nextSyncVersion(),
            },
          })
          .returning({ id: paymentMethods.id });
        if (saved.length === 0) {
          const [current] = await transaction
            .select()
            .from(paymentMethods)
            .where(and(eq(paymentMethods.userId, userId), eq(paymentMethods.id, payload.id)))
            .limit(1);
          if (!current) throw new Error("payment method conflict row disappeared");
          staleChanges.push(paymentMethodChange(current));
        }
      };

      const savePayment = async (payload: PaymentPushPayload) => {
        await assertPaymentMethodOwned(payload.paymentMethodId);
        if (payload.groupId !== null) await assertGroupOwned(payload.groupId);

        const saved = await transaction
          .insert(payments)
          .values({
            id: payload.id,
            userId,
            amount: payload.amount,
            paymentMethodId: payload.paymentMethodId,
            title: payload.title,
            groupId: payload.groupId,
            paidAt: date(payload.paidAt),
            createdAt: date(payload.createdAt),
            updatedAt: date(payload.updatedAt),
            deletedAt: payload.deletedAt === null ? null : date(payload.deletedAt),
          })
          .onConflictDoUpdate({
            target: [payments.userId, payments.id],
            where: sql`${payments.updatedAt} <= excluded.updated_at`,
            set: {
              amount: payload.amount,
              paymentMethodId: payload.paymentMethodId,
              title: payload.title,
              groupId: payload.groupId,
              paidAt: date(payload.paidAt),
              updatedAt: date(payload.updatedAt),
              deletedAt: payload.deletedAt === null ? null : date(payload.deletedAt),
              syncVersion: nextSyncVersion(),
            },
          })
          .returning({ id: payments.id });
        if (saved.length === 0) {
          const [current] = await transaction
            .select()
            .from(payments)
            .where(and(eq(payments.userId, userId), eq(payments.id, payload.id)))
            .limit(1);
          if (!current) throw new Error("payment conflict row disappeared");
          staleChanges.push(paymentChange(current));
        }
      };

      const saveSettings = async (payload: SettingsPushPayload) => {
        if (payload.currentGroupId !== null) await assertGroupOwned(payload.currentGroupId);

        const saved = await transaction
          .insert(userSettings)
          .values({
            userId,
            currentGroupId: payload.currentGroupId,
            createdAt: date(payload.createdAt),
            updatedAt: date(payload.updatedAt),
            deletedAt: null,
          })
          .onConflictDoUpdate({
            target: userSettings.userId,
            where: sql`${userSettings.updatedAt} <= excluded.updated_at`,
            set: {
              currentGroupId: payload.currentGroupId,
              updatedAt: date(payload.updatedAt),
              deletedAt: null,
              syncVersion: nextSyncVersion(),
            },
          })
          .returning({ userId: userSettings.userId });
        if (saved.length === 0) {
          const [current] = await transaction
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1);
          if (!current) throw new Error("settings conflict row disappeared");
          staleChanges.push(settingsChange(current));
        }
      };

      for (const operation of orderedOperations(parsed.operations)) {
        switch (operation.type) {
          case "GROUP_UPSERT":
          case "GROUP_DELETE":
            await saveGroup(operation.payload);
            break;
          case "PAYMENT_METHOD_UPSERT":
            await savePaymentMethod(operation.payload);
            break;
          case "PAYMENT_UPSERT":
          case "PAYMENT_DELETE":
            await savePayment(operation.payload);
            break;
          case "SETTINGS_UPSERT":
            await saveSettings(operation.payload);
            break;
        }
      }
    });
  } catch (error) {
    if (error instanceof PushRejectedError) {
      return NextResponse.json({ accepted: [], error: "ownership-check-failed", message: error.message }, { status: 422 });
    }
    return NextResponse.json({ accepted: [], error: "sync-failed" }, { status: 500 });
  }

  return NextResponse.json({
    accepted: parsed.operations.map((operation) => operation.id),
    changes: staleChanges,
  });
}
