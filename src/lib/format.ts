import type { Group, Payment, PaymentMethod } from "./types";

export const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

export function formatYen(amount: number) {
  return yen.format(amount);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(value));
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDateTimeInput(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function paymentLabel(
  payment: Payment,
  paymentMethods: PaymentMethod[],
  groups: Group[],
) {
  return {
    method:
      paymentMethods.find((method) => method.id === payment.paymentMethodId)
        ?.name ?? "不明な方法",
    group: groups.find((group) => group.id === payment.groupId)?.name,
    title: payment.title || undefined,
  };
}
