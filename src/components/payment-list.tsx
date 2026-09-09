import { formatDate, formatTime, formatYen } from "@/lib/format";
import type { Group, Payment, PaymentMethod } from "@/lib/types";
import { OfflineAwareLink } from "@/components/offline-aware-link";

export function PaymentList({
  payments,
  paymentMethods,
  groups,
  emptyMessage = "まだ支払いがありません。",
  selectable = false,
  selectedPaymentIds,
  onTogglePayment,
}: {
  payments: Payment[];
  paymentMethods: PaymentMethod[];
  groups: Group[];
  emptyMessage?: string;
  selectable?: boolean;
  selectedPaymentIds?: ReadonlySet<string>;
  onTogglePayment?: (paymentId: string) => void;
}) {
  if (payments.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="payment-list">
      {payments.map((payment) => {
        const method = paymentMethods.find((item) => item.id === payment.paymentMethodId);
        const group = groups.find((item) => item.id === payment.groupId);
        const rowContent = <>
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
        </>;

        if (selectable) {
          return <div className="payment-row payment-row-selectable" key={payment.id}>
            <label className="payment-select">
              <input type="checkbox" checked={selectedPaymentIds?.has(payment.id) ?? false} onChange={() => onTogglePayment?.(payment.id)} aria-label={`${payment.title || "支払い"}を選択`} />
            </label>
            <OfflineAwareLink href={`/payments/${payment.id}`} className="payment-row-link">
              {rowContent}
            </OfflineAwareLink>
          </div>;
        }

        return <OfflineAwareLink href={`/payments/${payment.id}`} className="payment-row" key={payment.id}>
          {rowContent}
        </OfflineAwareLink>;
      })}
    </div>
  );
}

export function PaymentDateHeading({ value }: { value: string }) {
  return <h3 className="date-heading">{formatDate(value)}</h3>;
}
