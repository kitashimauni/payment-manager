import type { Group, Payment, PaymentMethod } from "./types";

export type PaymentExportRecord = Payment & {
  groupName: string | null;
  paymentMethodName: string | null;
};

export type PaymentExportData = {
  schemaVersion: 1;
  exportedAt: string;
  payments: PaymentExportRecord[];
};

const csvColumns: Array<{ key: keyof PaymentExportRecord; label: string }> = [
  { key: "id", label: "id" },
  { key: "amount", label: "amount" },
  { key: "paidAt", label: "paidAt" },
  { key: "title", label: "title" },
  { key: "groupId", label: "groupId" },
  { key: "groupName", label: "groupName" },
  { key: "paymentMethodId", label: "paymentMethodId" },
  { key: "paymentMethodName", label: "paymentMethodName" },
  { key: "createdAt", label: "createdAt" },
  { key: "updatedAt", label: "updatedAt" },
  { key: "deletedAt", label: "deletedAt" },
];

export function buildPaymentExportData(
  payments: readonly Payment[],
  groups: readonly Group[],
  paymentMethods: readonly PaymentMethod[],
  exportedAt: string,
): PaymentExportData {
  return {
    schemaVersion: 1,
    exportedAt,
    payments: payments
      .filter((payment) => !payment.deletedAt)
      .map((payment) => ({
        ...payment,
        groupName: groups.find((group) => group.id === payment.groupId)?.name ?? null,
        paymentMethodName: paymentMethods.find((method) => method.id === payment.paymentMethodId)?.name ?? null,
      })),
  };
}

function escapeCsvCell(value: unknown, protectFormula = false) {
  let text = value === null || value === undefined ? "" : String(value);
  if (protectFormula && /^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function serializePaymentExportCsv(data: PaymentExportData) {
  const header = csvColumns.map((column) => escapeCsvCell(column.label)).join(",");
  const rows = data.payments.map((payment) => csvColumns.map((column) => escapeCsvCell(payment[column.key], column.key === "title" || column.key === "groupName" || column.key === "paymentMethodName")).join(","));
  return `\uFEFF${[header, ...rows].join("\r\n")}\r\n`;
}

export function serializePaymentExportJson(data: PaymentExportData) {
  return `${JSON.stringify(data, null, 2)}\n`;
}
