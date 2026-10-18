export function individualPaymentSummary(input: {
  commercialStatus: string | null;
  classKind: string | null;
  amountMinor: number | null;
  currency: string;
  locale: string;
}): string | null {
  if (
    input.commercialStatus !== "paid" ||
    input.classKind !== "drop_in" ||
    input.amountMinor == null ||
    !Number.isFinite(input.amountMinor) ||
    input.amountMinor <= 0
  ) {
    return null;
  }
  const amount = new Intl.NumberFormat(input.locale, {
    style: "currency",
    currency: input.currency,
  }).format(input.amountMinor / 100);
  return `${amount} pagados`;
}
