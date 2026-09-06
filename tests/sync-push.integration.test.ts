import { and, eq } from "drizzle-orm";
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
  let database: NonNullable<(typeof import("../src/server/db/client"))["db"]>;
  let sqlClient: NonNullable<(typeof import("../src/server/db/client"))["sql"]>;
  let tables: typeof import("../src/server/db/schema");

  const request = (operations: unknown[]) =>
    new Request("http://localhost/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations }),
    });

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
    const client = await import("../src/server/db/client");
    tables = await import("../src/server/db/schema");
    post = route.POST;
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
