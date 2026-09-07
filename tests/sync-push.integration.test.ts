import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testDatabaseUrl = process.env.SYNC_TEST_DATABASE_URL;
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock("@/auth", () => ({ auth: authMock, authEnabled: true }));

const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

integrationDescribe("authenticated sync push", () => {
  const userId = "sync-push-integration-user";
  const foreignUserId = "sync-push-integration-foreign-user";
  const timestamp = "2026-09-06T00:00:00.000Z";
  let post: typeof import("../app/api/sync/push/route").POST;
  let pull: typeof import("../app/api/sync/pull/route").GET;
  let database: NonNullable<(typeof import("../src/server/db/client"))["db"]>;
  let sqlClient: NonNullable<(typeof import("../src/server/db/client"))["sql"]>;
  let tables: typeof import("../src/server/db/schema");

  const request = (operations: unknown[]) =>
    new Request("http://localhost/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations }),
    });

  const pullRequest = (cursor?: string) =>
    new Request(`http://localhost/api/sync/pull${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);

  const paymentPayload = (id: string, paymentMethodId: string, groupId: string | null = null) => ({
    id,
    amount: 1200,
    paymentMethodId,
    title: "統合テスト",
    groupId,
    paidAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    userId: "client-must-not-control-owner",
  });

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error("SYNC_TEST_DATABASE_URL is required");
    process.env.DATABASE_URL = testDatabaseUrl;
    const route = await import("../app/api/sync/push/route");
    const pullRoute = await import("../app/api/sync/pull/route");
    const client = await import("../src/server/db/client");
    tables = await import("../src/server/db/schema");
    post = route.POST;
    pull = pullRoute.GET;
    database = client.db!;
    sqlClient = client.sql!;
  });

  beforeEach(async () => {
    await database.delete(tables.users).where(eq(tables.users.id, userId));
    await database.delete(tables.users).where(eq(tables.users.id, foreignUserId));
    await database.insert(tables.users).values({ id: userId, email: `${userId}@example.test` });
    authMock.mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    if (!database || !tables || !sqlClient) return;

    await database.delete(tables.users).where(eq(tables.users.id, userId));
    await database.delete(tables.users).where(eq(tables.users.id, foreignUserId));
    await sqlClient.end({ timeout: 1 });
  });

  it("assigns the session user, upserts related entities, and accepts all operations", async () => {
    const operations = [
      {
        id: "operation-group",
        type: "GROUP_UPSERT",
        entityId: "group-1",
        createdAt: timestamp,
        payload: { id: "group-1", name: "仕事", status: "active", createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
      },
      {
        id: "operation-method",
        type: "PAYMENT_METHOD_UPSERT",
        entityId: "method-1",
        createdAt: timestamp,
        payload: { id: "method-1", name: "カード", sortOrder: 0, isActive: true, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
      },
      {
        id: "operation-payment",
        type: "PAYMENT_UPSERT",
        entityId: "payment-1",
        createdAt: timestamp,
        payload: paymentPayload("payment-1", "method-1", "group-1"),
      },
      {
        id: "operation-settings",
        type: "SETTINGS_UPSERT",
        entityId: "local",
        createdAt: timestamp,
        payload: { id: "local", currentGroupId: "group-1", createdAt: timestamp, updatedAt: timestamp },
      },
    ];

    const response = await post(request(operations));
    const body = (await response.json()) as { accepted: string[] };

    expect(response.status).toBe(200);
    expect(body.accepted).toEqual(operations.map((operation) => operation.id));

    const [payment] = await database
      .select()
      .from(tables.payments)
      .where(and(eq(tables.payments.userId, userId), eq(tables.payments.id, "payment-1")));
    const [settings] = await database
      .select()
      .from(tables.userSettings)
      .where(eq(tables.userSettings.userId, userId));

    expect(payment).toMatchObject({ userId, id: "payment-1", paymentMethodId: "method-1", groupId: "group-1" });
    expect(settings).toMatchObject({ userId, currentGroupId: "group-1" });
  });

  it("keeps the newer server state when an older update arrives", async () => {
    const newer = {
      id: "operation-lww-newer",
      type: "GROUP_UPSERT",
      entityId: "lww-group",
      createdAt: timestamp,
      payload: {
        id: "lww-group",
        name: "新しい更新",
        status: "active",
        createdAt: timestamp,
        updatedAt: "2026-09-07T00:02:00.000Z",
        deletedAt: null,
      },
    };
    const older = {
      id: "operation-lww-older",
      type: "GROUP_UPSERT",
      entityId: "lww-group",
      createdAt: timestamp,
      payload: {
        ...newer.payload,
        name: "古い更新",
        updatedAt: "2026-09-07T00:01:00.000Z",
      },
    };

    expect((await post(request([newer]))).status).toBe(200);
    expect((await post(request([older]))).status).toBe(200);

    const [stored] = await database
      .select()
      .from(tables.groups)
      .where(and(eq(tables.groups.userId, userId), eq(tables.groups.id, "lww-group")));
    expect(stored).toMatchObject({ name: "新しい更新", updatedAt: new Date("2026-09-07T00:02:00.000Z") });
  });

  it("returns owned changes in a stable order and resumes after its cursor", async () => {
    const operations = [
      {
        id: "operation-pull-group",
        type: "GROUP_UPSERT",
        entityId: "pull-group",
        createdAt: timestamp,
        payload: { id: "pull-group", name: "Pull", status: "active", createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
      },
      {
        id: "operation-pull-method",
        type: "PAYMENT_METHOD_UPSERT",
        entityId: "pull-method",
        createdAt: timestamp,
        payload: { id: "pull-method", name: "Pullカード", sortOrder: 0, isActive: true, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
      },
      {
        id: "operation-pull-payment",
        type: "PAYMENT_UPSERT",
        entityId: "pull-payment",
        createdAt: timestamp,
        payload: paymentPayload("pull-payment", "pull-method", "pull-group"),
      },
      {
        id: "operation-pull-settings",
        type: "SETTINGS_UPSERT",
        entityId: "local",
        createdAt: timestamp,
        payload: { id: "local", currentGroupId: "pull-group", createdAt: timestamp, updatedAt: timestamp },
      },
    ];

    expect((await post(request(operations))).status).toBe(200);

    const firstResponse = await pull(pullRequest());
    const firstBody = (await firstResponse.json()) as {
      changes: Array<{ type: string; entityId: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(firstResponse.status).toBe(200);
    expect(firstBody.changes.map((change) => change.type)).toEqual([
      "GROUP_UPSERT",
      "PAYMENT_METHOD_UPSERT",
      "PAYMENT_UPSERT",
      "SETTINGS_UPSERT",
    ]);
    expect(firstBody.changes.map((change) => change.entityId)).toEqual([
      "pull-group",
      "pull-method",
      "pull-payment",
      "local",
    ]);
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    expect(firstBody.hasMore).toBe(false);

    const lateOperation = {
      id: "operation-pull-late-payment",
      type: "PAYMENT_UPSERT",
      entityId: "pull-late-payment",
      createdAt: "2026-09-05T23:59:00.000Z",
      payload: {
        ...paymentPayload("pull-late-payment", "pull-method"),
        createdAt: "2026-09-05T23:59:00.000Z",
        updatedAt: "2026-09-05T23:59:00.000Z",
        paidAt: "2026-09-05T23:59:00.000Z",
      },
    };
    expect((await post(request([lateOperation]))).status).toBe(200);

    const secondResponse = await pull(pullRequest(firstBody.nextCursor!));
    const secondBody = (await secondResponse.json()) as {
      changes: Array<{ type: string; entityId: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(secondResponse.status).toBe(200);
    expect(secondBody.changes).toEqual([{ type: "PAYMENT_UPSERT", entityId: "pull-late-payment", payload: expect.any(Object) }]);
    expect(secondBody.nextCursor).not.toBe(firstBody.nextCursor);
    expect(secondBody.hasMore).toBe(false);

    const thirdResponse = await pull(pullRequest(secondBody.nextCursor!));
    const thirdBody = (await thirdResponse.json()) as { changes: unknown[]; nextCursor: string | null; hasMore: boolean };
    expect(thirdResponse.status).toBe(200);
    expect(thirdBody.changes).toEqual([]);
    expect(thirdBody.nextCursor).toBe(secondBody.nextCursor);
    expect(thirdBody.hasMore).toBe(false);
  });

  it("rejects an invalid cursor before querying changes", async () => {
    const response = await pull(pullRequest("invalid-cursor"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "sync-pull-failed" });
  });

  it("serializes same-user pushes before assigning sync versions", async () => {
    const lockSql = postgres(testDatabaseUrl!, { max: 1 });
    let releaseLock!: () => void;
    let signalLockReady!: () => void;
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockReady = new Promise<void>((resolve) => {
      signalLockReady = resolve;
    });

    const lockTransaction = lockSql.begin(async (transactionSql) => {
      await transactionSql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
      signalLockReady();
      await lockReleased;
    });

    try {
      await lockReady;
      const operations = [
        {
          id: "operation-concurrent-group-a",
          type: "GROUP_UPSERT",
          entityId: "concurrent-group-a",
          createdAt: timestamp,
          payload: { id: "concurrent-group-a", name: "同時A", status: "active", createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
        },
        {
          id: "operation-concurrent-group-b",
          type: "GROUP_UPSERT",
          entityId: "concurrent-group-b",
          createdAt: timestamp,
          payload: { id: "concurrent-group-b", name: "同時B", status: "active", createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
        },
      ];
      const pushes = operations.map((operation) => post(request([operation])));
      const resultBeforeRelease = await Promise.race([
        Promise.all(pushes).then(() => "completed" as const),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100)),
      ]);
      expect(resultBeforeRelease).toBe("blocked");

      releaseLock();
      const responses = await Promise.all(pushes);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      await lockTransaction;

      const response = await pull(pullRequest());
      const body = (await response.json()) as { changes: Array<{ entityId: string }> };
      expect(response.status).toBe(200);
      expect(body.changes).toEqual([
        expect.objectContaining({ entityId: "concurrent-group-a" }),
        expect.objectContaining({ entityId: "concurrent-group-b" }),
      ]);
    } finally {
      releaseLock();
      await lockTransaction.catch(() => undefined);
      await lockSql.end({ timeout: 1 });
    }
  });

  it("creates a missing Local First default method for a payment", async () => {
    const operation = {
      id: "operation-default-payment",
      type: "PAYMENT_UPSERT",
      entityId: "payment-default",
      createdAt: timestamp,
      payload: paymentPayload("payment-default", "default-method-0"),
    };

    const response = await post(request([operation]));
    expect(response.status).toBe(200);

    const [method] = await database
      .select()
      .from(tables.paymentMethods)
      .where(and(eq(tables.paymentMethods.userId, userId), eq(tables.paymentMethods.id, "default-method-0")));
    expect(method).toMatchObject({ userId, id: "default-method-0", name: "現金" });
  });

  it("rolls back earlier operations when a referenced entity is not owned", async () => {
    await database.insert(tables.users).values({ id: foreignUserId, email: `${foreignUserId}@example.test` });
    await database.insert(tables.paymentMethods).values({
      id: "foreign-method",
      userId: foreignUserId,
      name: "他人の方法",
      sortOrder: 0,
      isActive: true,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      deletedAt: null,
    });

    const response = await post(request([
      {
        id: "operation-rollback-group",
        type: "GROUP_UPSERT",
        entityId: "rollback-group",
        createdAt: timestamp,
        payload: { id: "rollback-group", name: "ロールバック", status: "active", createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
      },
      {
        id: "operation-foreign-payment",
        type: "PAYMENT_UPSERT",
        entityId: "foreign-payment",
        createdAt: timestamp,
        payload: paymentPayload("foreign-payment", "foreign-method"),
      },
    ]));

    expect(response.status).toBe(422);
    const groups = await database
      .select()
      .from(tables.groups)
      .where(and(eq(tables.groups.userId, userId), eq(tables.groups.id, "rollback-group")));
    expect(groups).toEqual([]);
  });

  it("stores logical deletes and remains idempotent on retry", async () => {
    const upsert = {
      id: "operation-idempotent-upsert",
      type: "PAYMENT_UPSERT",
      entityId: "payment-delete",
      createdAt: timestamp,
      payload: paymentPayload("payment-delete", "default-method-1"),
    };
    const deletion = {
      id: "operation-idempotent-delete",
      type: "PAYMENT_DELETE",
      entityId: "payment-delete",
      createdAt: timestamp,
      payload: { ...paymentPayload("payment-delete", "default-method-1"), deletedAt: "2026-09-06T00:01:00.000Z" },
    };

    expect((await post(request([upsert, deletion]))).status).toBe(200);
    expect((await post(request([deletion]))).status).toBe(200);

    const [payment] = await database
      .select()
      .from(tables.payments)
      .where(and(eq(tables.payments.userId, userId), eq(tables.payments.id, "payment-delete")));
    expect(payment?.deletedAt?.toISOString()).toBe("2026-09-06T00:01:00.000Z");
  });
});
