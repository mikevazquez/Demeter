type PaymentQuote = {
  status?: unknown;
  amount_minor?: unknown;
  currency?: unknown;
  external_checkout?: unknown;
  bank_details?: unknown;
};

export function firstClassPaymentInstructions(quote: PaymentQuote, request: string): string | null {
  if (quote.status !== "payment_required" || typeof quote.amount_minor !== "number") return null;
  const checkout = quote.external_checkout as { url?: string; test_only?: boolean } | null;
  const bank = quote.bank_details as Record<string, unknown> | null;
  const amount = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: String(quote.currency ?? "MXN"),
  }).format(quote.amount_minor / 100);
  const useCheckout = Boolean(
    checkout?.url && (/mercado\s*pago|tarjeta|enlace/i.test(request) || !bank),
  );
  let method: string;
  if (useCheckout) {
    method = `Mercado Pago: ${checkout!.url}${checkout!.test_only ? "\nModo prueba: no realices un pago real en este enlace." : ""}`;
  } else if (bank) {
    method = [
      "Transferencia bancaria:",
      bank.bank_name,
      bank.account_holder,
      bank.clabe
        ? `CLABE: ${bank.clabe}`
        : bank.account_number
          ? `Cuenta: ${bank.account_number}`
          : bank.card_number
            ? `Tarjeta: ${bank.card_number}`
            : null,
      bank.instructions,
    ]
      .filter(Boolean)
      .join("\n");
  } else return null;
  return `El importe de tu primera clase es ${amount}.\n\n${method}\n\nEnvíame el comprobante por este mismo chat. Después de revisarlo te pediré los datos faltantes para reservar. Todavía no hay una reserva confirmada ni un lugar retenido.`;
}
