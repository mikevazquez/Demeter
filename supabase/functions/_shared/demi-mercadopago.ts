export function demiCheckoutUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["www.mercadopago.com.mx", "mercadopago.com.mx"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function demiOrderBody(request: {
  amount_minor: number;
  currency: string;
  external_reference: string;
}) {
  if (
    !Number.isSafeInteger(request.amount_minor) ||
    request.amount_minor <= 0 ||
    request.currency !== "MXN" ||
    !/^demi_[0-9a-f-]{36}$/i.test(request.external_reference)
  )
    throw new Error("invalid_payment_snapshot");
  const amount = (request.amount_minor / 100).toFixed(2);
  return {
    type: "online",
    processing_mode: "manual",
    capture_mode: "automatic",
    total_amount: amount,
    external_reference: request.external_reference,
    expiration_time: "P1D",
    items: [{ title: "Primera clase", quantity: 1, unit_price: amount }],
    // OXXO is a direct deposit to Bancomer in this studio, never an MP ticket.
    config: { payment_method: { not_allowed_types: ["ticket"], not_allowed_ids: ["oxxo"] } },
  };
}
// Orders test-seller credentials may also start with APP_USR. Check the
// authenticated seller rather than inferring live mode from that prefix.
export async function demiTestSeller(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetcher("https://api.mercadopago.com/users/me", {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return false;
  const seller = await response.json();
  return (
    Array.isArray(seller.tags) && seller.tags.includes("test_user") && seller.site_id === "MLM"
  );
}
