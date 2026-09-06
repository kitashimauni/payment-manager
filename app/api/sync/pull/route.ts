import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth, authEnabled } from "@/auth";
import { db } from "@/server/db/client";
import { groups, payments, paymentMethods, userSettings, users } from "@/server/db/schema";
import {
  compareSyncPositions,
  decodeCursor,
  encodeCursor,
  isAfterCursor,
  type PullChange,
  type PullCursor,
  type SyncPosition,
} from "@/server/sync/pull";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

type PullRecord = SyncPosition & { change: PullChange };

function groupRecord(row: typeof groups.$inferSelect): PullRecord {
  const payload = {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
  return {
    kind: "groups",
    id: row.id,
    updatedAt: row.updatedAt,
    change: {
      type: row.deletedAt ? "GROUP_DELETE" : "GROUP_UPSERT",
      entityId: row.id,
      payload,
    },
  };
}

function paymentMethodRecord(row: typeof paymentMethods.$inferSelect): PullRecord {
  return {
    kind: "paymentMethods",
    id: row.id,
    updatedAt: row.updatedAt,
    change: {
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
    },
  };
}

function paymentRecord(row: typeof payments.$inferSelect): PullRecord {
  return {
    kind: "payments",
    id: row.id,
    updatedAt: row.updatedAt,
    change: {
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
    },
  };
}

function settingsRecord(row: typeof userSettings.$inferSelect): PullRecord {
  return {
    kind: "settings",
    id: "local",
    updatedAt: row.updatedAt,
    change: {
      type: "SETTINGS_UPSERT",
      entityId: "local",
      payload: {
        id: "local",
        currentGroupId: row.currentGroupId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    },
  };
}

function pullError(message: string, status: number) {
  return NextResponse.json({ changes: [], nextCursor: null, error: "sync-pull-failed", message }, { status });
}

export async function GET(request: Request) {
  const database = db;
  if (!authEnabled || !database) {
    return pullError("server sync is not configured", 503);
  }

  let session;
  try {
    session = await auth();
  } catch {
    return pullError("authentication is unavailable", 503);
  }

  const userId = session?.user?.id;
  if (!userId) {
    return pullError("authentication is required", 401);
  }

  let cursor: PullCursor | null;
  try {
    cursor = decodeCursor(new URL(request.url).searchParams.get("cursor"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "cursor is invalid";
    return pullError(message, 400);
  }

  try {
    const records = await database.transaction(async (transaction) => {
      const [user] = await transaction.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return null;

      const groupRows = await transaction.select().from(groups).where(eq(groups.userId, userId));
      const paymentMethodRows = await transaction.select().from(paymentMethods).where(eq(paymentMethods.userId, userId));
      const paymentRows = await transaction.select().from(payments).where(eq(payments.userId, userId));
      const settingsRows = await transaction.select().from(userSettings).where(eq(userSettings.userId, userId));

      return [
        ...groupRows.map(groupRecord),
        ...paymentMethodRows.map(paymentMethodRecord),
        ...paymentRows.map(paymentRecord),
        ...settingsRows.map(settingsRecord),
      ];
    });

    if (!records) return pullError("authenticated user does not exist", 401);

    const sortedRecords = records.filter((record) => isAfterCursor(record, cursor)).sort(compareSyncPositions);
    const page = sortedRecords.slice(0, PAGE_SIZE);
    const lastRecord = page.at(-1);
    const nextCursor = lastRecord ? encodeCursor(lastRecord) : cursor ? encodeCursor(cursor) : null;

    return NextResponse.json({
      changes: page.map((record) => record.change),
      nextCursor,
      hasMore: sortedRecords.length > PAGE_SIZE,
    });
  } catch {
    return pullError("sync pull failed", 500);
  }
}
