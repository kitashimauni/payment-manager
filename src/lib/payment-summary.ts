import type { Group, Payment, PaymentMethod } from "./types";

export type SummaryPeriod = {
  fromDate: string;
  toDate: string;
};

export type PaymentSummaryRow = {
  id: string;
  label: string;
  total: number;
  count: number;
};

export type PaymentSummary = {
  total: number;
  count: number;
  averageAmount: number;
  byGroup: PaymentSummaryRow[];
  byPaymentMethod: PaymentSummaryRow[];
};

function dateInputValue(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function getMonthPeriod(referenceDate: Date, monthOffset = 0): SummaryPeriod {
  const firstDay = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + monthOffset, 1);
  const lastDay = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0);
  return { fromDate: dateInputValue(firstDay), toDate: dateInputValue(lastDay) };
}

export function formatSummaryPeriod(period: SummaryPeriod) {
  return `${period.fromDate.replace(/-/g, "/")} 〜 ${period.toDate.replace(/-/g, "/")}`;
}

function localDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return dateInputValue(date);
}

function sortRows(rows: PaymentSummaryRow[]) {
  return rows.sort((left, right) => right.total - left.total || right.count - left.count || left.label.localeCompare(right.label, "ja"));
}

function addToRow(rows: Map<string, PaymentSummaryRow>, id: string, label: string, amount: number) {
  const current = rows.get(id);
  if (current) {
    current.total += amount;
    current.count += 1;
    return;
  }
  rows.set(id, { id, label, total: amount, count: 1 });
}

export function summarizePayments(
  payments: readonly Payment[],
  groups: readonly Group[],
  paymentMethods: readonly PaymentMethod[],
  period: SummaryPeriod,
): PaymentSummary {
  const groupRows = new Map<string, PaymentSummaryRow>();
  const methodRows = new Map<string, PaymentSummaryRow>();
  let total = 0;
  let count = 0;

  payments.forEach((payment) => {
    if (payment.deletedAt) return;
    const paidDate = localDateKey(payment.paidAt);
    if (!paidDate || paidDate < period.fromDate || paidDate > period.toDate) return;

    total += payment.amount;
    count += 1;

    const group = payment.groupId ? groups.find((item) => item.id === payment.groupId) : undefined;
    addToRow(groupRows, payment.groupId ?? "__no-group__", group?.name ?? (payment.groupId ? "不明なグループ" : "グループなし"), payment.amount);

    const method = paymentMethods.find((item) => item.id === payment.paymentMethodId);
    const methodLabel = method
      ? `${method.name}${!method.isActive || method.deletedAt ? "（アーカイブ済み）" : ""}`
      : "不明な方法";
    addToRow(methodRows, payment.paymentMethodId, methodLabel, payment.amount);
  });

  return {
    total,
    count,
    averageAmount: count === 0 ? 0 : Math.round(total / count),
    byGroup: sortRows(Array.from(groupRows.values())),
    byPaymentMethod: sortRows(Array.from(methodRows.values())),
  };
}
