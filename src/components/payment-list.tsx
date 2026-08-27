import Link from "next/link";
import { formatDate, formatTime, formatYen } from "@/lib/format";
import type { Group, Payment, PaymentMethod } from "@/lib/types";

export function PaymentList({
  payments,
  paymentMethods,
  groups,
  emptyMessage = "まだ支払いがありません。",
}: {
  payments: Payment[];
  paymentMethods: PaymentMethod[];
  groups: Group[];
  emptyMessage?: string;
}) {
  if (payments.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="payment-list">
      {payments.map((payment) => {
        const method = paymentMethods.find((item) => item.id === payment.paymentMethodId);
        const group = groups.find((item) => item.id === payment.groupId);
        return (
          <Link href={`/payments/${payment.id}`} className="payment-row" key={payment.id}>
            <div className="payment-row-main">
              <span className={payment.title ? "payment-title" : "payment-title muted"}>
                {payment.title || "支払い"}
              </span>
              <span className="payment-amount">{formatYen(payment.amount)}</span>
            </div>
            <div className="payment-row-meta">
              <span>{method?.name ?? "不明な方法"}</span>
              {group ? <span className="tag">{group.name}</span> : null}
              <time dateTime={payment.paidAt}>{formatTime(payment.paidAt)}</time>
            </div>
            <span className="row-chevron" aria-hidden="true">›</span>
          </Link>
        );
      })}
    </div>
  );
}

export function PaymentDateHeading({ value }: { value: string }) {
  return <h3 className="date-heading">{formatDate(value)}</h3>;
}
