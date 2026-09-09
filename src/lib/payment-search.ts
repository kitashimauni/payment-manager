import type { Payment } from "./types";

export const ALL_FILTER = "all";
export const NO_GROUP_FILTER = "__no-group__";

export type PaymentSearchFilters = {
  query: string;
  minAmount: string;
  maxAmount: string;
  fromDate: string;
  toDate: string;
  groupId: string;
  paymentMethodId: string;
};

export const DEFAULT_PAYMENT_SEARCH_FILTERS: PaymentSearchFilters = {
  query: "",
  minAmount: "",
  maxAmount: "",
  fromDate: "",
  toDate: "",
  groupId: ALL_FILTER,
  paymentMethodId: ALL_FILTER,
};

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseAmount(value: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const amount = Number(trimmed);
  return Number.isSafeInteger(amount) ? amount : null;
}

export function isPaymentAmountFilterValid(value: string) {
  return value.trim() === "" || parseAmount(value) !== null;
}

function normalizeDateFilter(value: string) {
  if (!DATE_INPUT_PATTERN.test(value)) return null;

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : value;
}

function localDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function isPaymentSearchActive(filters: PaymentSearchFilters) {
  return Boolean(
    filters.query.trim() ||
      filters.minAmount.trim() ||
      filters.maxAmount.trim() ||
      filters.fromDate ||
      filters.toDate ||
      filters.groupId !== ALL_FILTER ||
      filters.paymentMethodId !== ALL_FILTER,
  );
}

export function filterPayments(payments: readonly Payment[], filters: PaymentSearchFilters) {
  const query = filters.query.trim().toLocaleLowerCase("ja-JP");
  const minAmount = parseAmount(filters.minAmount);
  const maxAmount = parseAmount(filters.maxAmount);
  const fromDate = normalizeDateFilter(filters.fromDate);
  const toDate = normalizeDateFilter(filters.toDate);

  return payments
    .filter((payment) => {
      if (payment.deletedAt) return false;

      if (query && !(payment.title?.toLocaleLowerCase("ja-JP").includes(query) ?? false)) return false;
      if (minAmount !== null && payment.amount < minAmount) return false;
      if (maxAmount !== null && payment.amount > maxAmount) return false;

      if (fromDate || toDate) {
        const paidDate = localDateKey(payment.paidAt);
        if (!paidDate || (fromDate && paidDate < fromDate) || (toDate && paidDate > toDate)) return false;
      }

      if (filters.groupId === NO_GROUP_FILTER && payment.groupId) return false;
      if (filters.groupId !== ALL_FILTER && filters.groupId !== NO_GROUP_FILTER && payment.groupId !== filters.groupId) return false;
      if (filters.paymentMethodId !== ALL_FILTER && payment.paymentMethodId !== filters.paymentMethodId) return false;

      return true;
    })
    .sort((a, b) => {
      const aTime = new Date(a.paidAt).getTime();
      const bTime = new Date(b.paidAt).getTime();
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
      return bTime - aTime;
    });
}
