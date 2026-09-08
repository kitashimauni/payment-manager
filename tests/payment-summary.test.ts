import { describe, expect, it } from "vitest";
import { getMonthPeriod, isSummaryPeriodValid, summarizePayments } from "../src/lib/payment-summary";
import type { Group, Payment, PaymentMethod } from "../src/lib/types";

function payment(id: string, overrides: Partial<Payment> = {}): Payment {
  const timestamp = "2026-09-08T12:00:00.000Z";
  return {
    id,
    amount: 1200,
    paymentMethodId: "active-method",
    title: "テストの支払い",
    groupId: null,
    paidAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

const groups: Group[] = [
  { id: "trip", name: "京都旅行", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null },
  { id: "work", name: "出張", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null },
];

const paymentMethods: PaymentMethod[] = [
  { id: "active-method", name: "PayPay", sortOrder: 0, isActive: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null },
  { id: "archived-method", name: "旧カード", sortOrder: 1, isActive: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null },
];

describe("payment summary", () => {
  it("calculates the total, count, and average for the selected month", () => {
    const payments = [
      payment("in-month-a", { amount: 1000, paidAt: "2026-09-01T12:00:00.000Z" }),
      payment("in-month-b", { amount: 2000, paidAt: "2026-09-30T12:00:00.000Z" }),
      payment("outside-period", { amount: 9000, paidAt: "2026-10-01T12:00:00.000Z" }),
      payment("deleted", { amount: 8000, deletedAt: "2026-09-02T12:00:00.000Z" }),
    ];

    expect(summarizePayments(payments, groups, paymentMethods, { fromDate: "2026-09-01", toDate: "2026-09-30" })).toMatchObject({
      total: 3000,
      count: 2,
      averageAmount: 1500,
    });
  });

  it("keeps groupless payments and archived payment methods in their own breakdowns", () => {
    const summary = summarizePayments([
      payment("groupless", { amount: 500, paymentMethodId: "archived-method", groupId: null }),
      payment("trip", { amount: 1500, paymentMethodId: "active-method", groupId: "trip" }),
      payment("work", { amount: 1000, paymentMethodId: "active-method", groupId: "work" }),
    ], groups, paymentMethods, { fromDate: "2026-09-01", toDate: "2026-09-30" });

    expect(summary.byGroup).toEqual([
      { id: "trip", label: "京都旅行", total: 1500, count: 1 },
      { id: "work", label: "出張", total: 1000, count: 1 },
      { id: "__no-group__", label: "グループなし", total: 500, count: 1 },
    ]);
    expect(summary.byPaymentMethod).toEqual([
      { id: "active-method", label: "PayPay", total: 2500, count: 2 },
      { id: "archived-method", label: "旧カード（アーカイブ済み）", total: 500, count: 1 },
    ]);
  });

  it("creates inclusive current and previous month periods", () => {
    const referenceDate = new Date(2026, 8, 8);
    expect(getMonthPeriod(referenceDate)).toEqual({ fromDate: "2026-09-01", toDate: "2026-09-30" });
    expect(getMonthPeriod(referenceDate, -1)).toEqual({ fromDate: "2026-08-01", toDate: "2026-08-31" });
    expect(getMonthPeriod(new Date(2026, 9, 1))).toEqual({ fromDate: "2026-10-01", toDate: "2026-10-31" });
  });

  it("rejects incomplete and reversed custom periods", () => {
    expect(isSummaryPeriodValid({ fromDate: "", toDate: "2026-09-30" })).toBe(false);
    expect(isSummaryPeriodValid({ fromDate: "2026-10-01", toDate: "2026-09-30" })).toBe(false);
    expect(isSummaryPeriodValid({ fromDate: "2026-09-01", toDate: "2026-09-30" })).toBe(true);
  });
});
