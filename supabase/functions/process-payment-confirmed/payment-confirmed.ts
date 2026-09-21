export const PAYMENT_CONFIRMED_CATALOG_CODE = "AUT-CAT-05";
export const PAYMENT_CONFIRMED_TEMPLATE = "payment_confirmed";
export const PAYMENT_CONFIRMED_CONSUMER_KEY = "sf176.payment_confirmed";

export interface PaymentConfirmedCondition {
  key: string;
  kind: "protected";
  applies: true;
  passed: boolean;
  reason_code: string;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface PaymentConfirmedVariableInput {
  amountMinor: number;
  currency: string;
  concept: string;
  method: string;
  packageName: string | null;
  balanceMinor: number;
}

export interface PaymentConfirmedVariables {
  monto: string;
  concepto: string;
  metodo: string;
  paquete: string | null;
  saldo_pendiente: string | null;
}

export interface MessagingProviderInput {
  recipient: string;
  template: string;
  variables: Record<string, unknown>;
  executionId: string;
  metadata: Record<string, unknown>;
}

export interface MessagingProviderAcceptedResult {
  status: "accepted";
  providerReference?: string;
  responseSnapshot?: Record<string, unknown>;
}

export interface MessagingProviderErrorResult {
  status: "error";
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  responseSnapshot?: Record<string, unknown>;
}

export type MessagingProviderResult =
  | MessagingProviderAcceptedResult
  | MessagingProviderErrorResult;

export interface MessagingProvider {
  readonly key: string;
  send(input: MessagingProviderInput): Promise<MessagingProviderResult>;
}

export class MockMessagingProvider implements MessagingProvider {
  readonly key = "mock";

  private readonly recordedDeliveries: MessagingProviderInput[] = [];

  get deliveries(): readonly MessagingProviderInput[] {
    return this.recordedDeliveries;
  }

  async send(input: MessagingProviderInput): Promise<MessagingProviderResult> {
    const deliveryNumber = this.recordedDeliveries.length + 1;
    this.recordedDeliveries.push({
      ...input,
      variables: { ...input.variables },
      metadata: { ...input.metadata },
    });

    return {
      status: "accepted",
      providerReference: `mock:${input.executionId}:${deliveryNumber}`,
      responseSnapshot: {
        mock: true,
        delivery_number: deliveryNumber,
      },
    };
  }
}

export function isValidWhatsAppRecipient(recipient: string | null | undefined) {
  return /^\+[1-9][0-9]{7,14}$/.test(recipient?.trim() ?? "");
}

export function buildPaymentConfirmedConditions(input: {
  paymentKind: string | null;
  paymentAmountMinor: number | null;
  saleStatus: string | null;
  studentId: string | null;
  recipient: string | null;
  eventMatchesPayment: boolean;
  contextComplete: boolean;
}): PaymentConfirmedCondition[] {
  const paymentConfirmed =
    input.paymentKind === "payment" &&
    Number(input.paymentAmountMinor ?? 0) > 0 &&
    input.saleStatus === "confirmed" &&
    input.eventMatchesPayment &&
    input.contextComplete;

  return [
    {
      key: "payment.confirmed",
      kind: "protected",
      applies: true,
      passed: paymentConfirmed,
      reason_code: paymentConfirmed ? "payment_confirmed" : "payment_not_confirmed",
      reason: paymentConfirmed
        ? "El pago está confirmado y conserva el snapshot comercial del momento."
        : "El pago no está confirmado o su contexto no coincide con el evento.",
      evidence: {
        payment_kind: input.paymentKind,
        amount_minor: input.paymentAmountMinor,
        sale_status: input.saleStatus,
        event_matches_payment: input.eventMatchesPayment,
        context_complete: input.contextComplete,
      },
    },
    {
      key: "student.identified",
      kind: "protected",
      applies: true,
      passed: Boolean(input.studentId),
      reason_code: input.studentId ? "student_identified" : "student_not_identified",
      reason: input.studentId
        ? "La alumna está identificada."
        : "No se pudo identificar a la alumna asociada al pago.",
    },
    {
      key: "channel.available",
      kind: "protected",
      applies: true,
      passed: isValidWhatsAppRecipient(input.recipient),
      reason_code: isValidWhatsAppRecipient(input.recipient)
        ? "whatsapp_contact_valid"
        : "whatsapp_contact_invalid",
      reason: isValidWhatsAppRecipient(input.recipient)
        ? "El canal de WhatsApp tiene un destinatario válido."
        : "El teléfono no es un destinatario E.164 válido para WhatsApp.",
    },
  ];
}

function safeCurrency(currency: string) {
  const normalized = currency.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "MXN";
}

export function formatMoney(amountMinor: number, currency: string) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("payment_confirmed_amount_invalid");
  }

  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: safeCurrency(currency),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function buildPaymentConfirmedVariables(
  input: PaymentConfirmedVariableInput,
): PaymentConfirmedVariables {
  const concept = input.concept.trim();
  const method = input.method.trim();

  if (!concept) throw new Error("payment_confirmed_concept_required");
  if (!method) throw new Error("payment_confirmed_method_required");

  return {
    monto: formatMoney(input.amountMinor, input.currency),
    concepto: concept,
    metodo: method,
    paquete: input.packageName?.trim() || null,
    saldo_pendiente:
      input.balanceMinor > 0 ? formatMoney(input.balanceMinor, input.currency) : null,
  };
}

export function paymentConfirmedIdempotencyKey(paymentId: string) {
  const id = paymentId.trim();
  if (!id) throw new Error("payment_confirmed_payment_required");
  return `sf176:payment:${id}`;
}

export function paymentConfirmedCandidateKey(paymentId: string) {
  const id = paymentId.trim();
  if (!id) throw new Error("payment_confirmed_payment_required");
  return `payment:${id}`;
}
