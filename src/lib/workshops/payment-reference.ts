const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** Cash uses the form's stable request identity when no receipt reference was entered. */
export function workshopPaymentReference(
  method: string,
  reference: string,
  requestId: string,
  minimumLength = 3,
): string | null {
  if (!["cash", "efectivo", "bank_transfer", "transferencia"].includes(method)) return null;
  const value = reference.trim();
  if (value) return value.length >= minimumLength && value.length <= 200 ? value : null;
  if (["cash", "efectivo"].includes(method) && uuid.test(requestId))
    return `cash:${requestId.toLowerCase()}`;
  return null;
}
