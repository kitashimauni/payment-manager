export const defaultPaymentMethods = ["現金", "Suica", "PayPay", "Visa", "Mastercard", "QUICPay"] as const;

export function defaultPaymentMethodName(id: string) {
  const prefix = "default-method-";
  if (!id.startsWith(prefix)) return undefined;

  const index = Number(id.slice(prefix.length));
  return Number.isInteger(index) && index >= 0 && index < defaultPaymentMethods.length
    ? defaultPaymentMethods[index]
    : undefined;
}
