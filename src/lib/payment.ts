import type { Payment } from "./types";

export function createPayment({
  id,
  amount,
  paymentMethodId,
  title,
  currentGroupId,
  timestamp,
}: {
  id: string;
  amount: number;
  paymentMethodId: string;
  title: string;
  currentGroupId: string | null | undefined;
  timestamp: string;
}): Payment {
  return {
    id,
    amount,
    paymentMethodId,
    title: title.trim() || null,
    groupId: currentGroupId ?? null,
    paidAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}
