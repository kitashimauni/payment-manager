import { describe, expect, it } from "vitest";
import {
  ALL_FILTER,
  DEFAULT_PAYMENT_SEARCH_FILTERS,
  filterPayments,
  isPaymentSearchActive,
  NO_GROUP_FILTER,
} from "../src/lib/payment-search";
import type { Payment } from "../src/lib/types";

function payment(id: string, overrides: Partial<Payment> = {}): Payment {
  const timestamp = "2026-09-01T12:00:00.000Z";
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

describe("payment history search", () => {
  it("matches a partial title without regard to letter case", () => {
    const payments = [
      payment("coffee", { title: "Coffee beans" }),
      payment("tea", { title: "Tea" }),
      payment("deleted-coffee", { title: "Coffee archive", deletedAt: "2026-09-02T12:00:00.000Z" }),
    ];

    expect(filterPayments(payments, { ...DEFAULT_PAYMENT_SEARCH_FILTERS, query: "COFFEE" }).map((item) => item.id)).toEqual(["coffee"]);
  });

  it("combines amount, date, group, and archived payment method filters", () => {
    const payments = [
      payment("target", {
        amount: 1500,
        title: "ホテル代",
        groupId: "trip",
        paymentMethodId: "archived-method",
        paidAt: "2026-09-01T12:00:00.000Z",
      }),
      payment("wrong-amount", { amount: 900, title: "ホテル代", groupId: "trip", paymentMethodId: "archived-method" }),
      payment("wrong-date", { amount: 1500, title: "ホテル代", groupId: "trip", paymentMethodId: "archived-method", paidAt: "2026-09-04T12:00:00.000Z" }),
      payment("wrong-group", { amount: 1500, title: "ホテル代", groupId: "other", paymentMethodId: "archived-method" }),
    ];

    expect(
      filterPayments(payments, {
        ...DEFAULT_PAYMENT_SEARCH_FILTERS,
        query: "ホテル",
        minAmount: "1500",
        maxAmount: "1500",
        fromDate: "2026-09-01",
        toDate: "2026-09-02",
        groupId: "trip",
        paymentMethodId: "archived-method",
      }).map((item) => item.id),
    ).toEqual(["target"]);
  });

  it("supports explicit groupless filtering and omits logical deletes", () => {
    const payments = [
      payment("groupless"),
      payment("grouped", { groupId: "trip" }),
      payment("deleted-groupless", { deletedAt: "2026-09-02T12:00:00.000Z" }),
    ];

    expect(filterPayments(payments, { ...DEFAULT_PAYMENT_SEARCH_FILTERS, groupId: NO_GROUP_FILTER }).map((item) => item.id)).toEqual(["groupless"]);
  });

  it("returns the active history in date order when conditions are cleared", () => {
    const payments = [
      payment("older", { paidAt: "2026-08-30T12:00:00.000Z" }),
      payment("newer", { paidAt: "2026-09-03T12:00:00.000Z" }),
      payment("deleted", { deletedAt: "2026-09-04T12:00:00.000Z" }),
    ];

    expect(isPaymentSearchActive(DEFAULT_PAYMENT_SEARCH_FILTERS)).toBe(false);
    expect(filterPayments(payments, DEFAULT_PAYMENT_SEARCH_FILTERS).map((item) => item.id)).toEqual(["newer", "older"]);
    expect(isPaymentSearchActive({ ...DEFAULT_PAYMENT_SEARCH_FILTERS, groupId: ALL_FILTER })).toBe(false);
  });
});
