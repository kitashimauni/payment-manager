import { describe, expect, it } from "vitest";
import { buildPaymentExportData, serializePaymentExportCsv, serializePaymentExportJson } from "../src/lib/payment-export";
import type { Group, Payment, PaymentMethod } from "../src/lib/types";

function payment(id: string, overrides: Partial<Payment> = {}): Payment {
  const timestamp = "2026-09-09T12:00:00.000Z";
  return {
    id,
    amount: 1280,
    paymentMethodId: "archived-method",
    title: "昼食, \"定食\"\r\n2行目",
    groupId: "trip",
    paidAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

const groups: Group[] = [
  { id: "trip", name: "京都旅行", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null },
];

const paymentMethods: PaymentMethod[] = [
  { id: "archived-method", name: "旧カード", sortOrder: 0, isActive: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null },
];

describe("payment export", () => {
  it("builds an import-ready snapshot with readable relation names", () => {
    const activePayment = payment("active");
    const deletedPayment = payment("deleted", { deletedAt: "2026-09-09T13:00:00.000Z" });
    const data = buildPaymentExportData([activePayment, deletedPayment], groups, paymentMethods, "2026-09-09T15:00:00.000Z");

    expect(data).toEqual({
      schemaVersion: 1,
      exportedAt: "2026-09-09T15:00:00.000Z",
      payments: [{ ...activePayment, groupName: "京都旅行", paymentMethodName: "旧カード" }],
    });
    expect(activePayment).toEqual(payment("active"));
  });

  it("quotes CSV values so commas, quotes, and newlines stay in one row", () => {
    const data = buildPaymentExportData([payment("csv")], groups, paymentMethods, "2026-09-09T15:00:00.000Z");
    const csv = serializePaymentExportCsv(data);

    expect(csv.startsWith("\uFEFF\"id\",\"amount\",\"paidAt\"")).toBe(true);
    expect(csv).toContain("\"昼食, \"\"定食\"\"\r\n2行目\"");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("prefixes formula-like free text before writing CSV", () => {
    const formulaPayments = ["=1+1", "+SUM(A1)", "-10", "@command"].map((title, index) => payment(`formula-${index}`, { title }));
    const csv = serializePaymentExportCsv(buildPaymentExportData(formulaPayments, groups, paymentMethods, "2026-09-09T15:00:00.000Z"));

    for (const title of ["=1+1", "+SUM(A1)", "-10", "@command"]) expect(csv).toContain(`"'${title}"`);
  });

  it("serializes valid JSON that can be read back without changing the snapshot", () => {
    const data = buildPaymentExportData([payment("json")], groups, paymentMethods, "2026-09-09T15:00:00.000Z");

    expect(JSON.parse(serializePaymentExportJson(data))).toEqual(data);
  });
});
