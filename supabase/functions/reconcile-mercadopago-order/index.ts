import { withSupabase } from "npm:@supabase/server";

type ReconcileRequest = {
  attemptId?: unknown;
};

type CheckoutAttempt = {
  id: string;
  external_reference: string;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  sale_id: string | null;
  processed_at: string | null;
};

type MercadoPagoPayment = {
  id?: unknown;
  status?: unknown;
  status_detail?: unknown;
  amount?: unknown;
  paid_amount?: unknown;
};

type MercadoPagoOrder = {
  id?: unknown;
  external_reference?: unknown;
  status?: unknown;
  status_detail?: unknown;
  total_amount?: unknown;
  total_paid_amount?: unknown;
  currency?: unknown;
  transactions?: {
    payments?: MercadoPagoPayment[];
  };
};

type MercadoPagoPaymentSearchItem = {
  id?: unknown;
  status?: unknown;
  status_detail?: unknown;
  transaction_amount?: unknown;
  currency_id?: unknown;
  external_reference?: unknown;
  date_created?: unknown;
  date_last_updated?: unknown;
};

type MercadoPagoPaymentSearchResponse = {
  results?: MercadoPagoPaymentSearchItem[];
};

type MappedAttemptStatus = {
  status: string;
  failureCode: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function moneyToMinor(value: unknown) {
  const raw = typeof value === "number" ? value.toFixed(2) : safeText(value);
  if (!raw || !/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

function mapAttemptStatus(
  providerStatus: string | null,
  providerStatusDetail: string | null,
): MappedAttemptStatus {
  const status = providerStatus?.toLowerCase() ?? "";
  const detail = providerStatusDetail?.toLowerCase() ?? "";

  if (status === "created") return { status: "order_created", failureCode: null };
  if (
    status === "processing" ||
    status === "action_required" ||
    status === "pending" ||
    status === "in_process" ||
    status === "authorized"
  ) {
    return { status: "pending", failureCode: null };
  }
  if (status === "failed" || status === "rejected") {
    return { status: "rejected", failureCode: detail || "provider_rejected" };
  }
  if (
    status === "canceled" ||
    status === "cancelled" ||
    status === "expired" ||
    status === "refunded" ||
    status === "charged_back"
  ) {
    return { status: "cancelled", failureCode: detail || null };
  }
  if (status === "processed") {
    return { status: "error", failureCode: `provider_processed_${detail || "unknown"}` };
  }
  return { status: "error", failureCode: `provider_status_${status || "unknown"}` };
}

function mapPaymentSearchStatus(
  providerStatus: string | null,
  providerStatusDetail: string | null,
): MappedAttemptStatus | null {
  const status = providerStatus?.toLowerCase() ?? "";
  const detail = providerStatusDetail?.toLowerCase() ?? "";

  if (status === "rejected") {
    return { status: "rejected", failureCode: detail || "provider_rejected" };
  }
  if (status === "pending" || status === "in_process" || status === "authorized") {
    return { status: "pending", failureCode: null };
  }
  if (
    status === "cancelled" ||
    status === "canceled" ||
    status === "refunded" ||
    status === "charged_back"
  ) {
    return { status: "cancelled", failureCode: detail || null };
  }
  return null;
}

function paymentSearchTimestamp(item: MercadoPagoPaymentSearchItem) {
  const raw = safeText(item.date_last_updated) ?? safeText(item.date_created);
  if (!raw) return 0;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function searchNonApprovedPayment(
  accessToken: string,
  externalReference: string,
  expectedAmountMinor: number,
  expectedCurrency: string,
) {
  const searchUrl = new URL("https://api.mercadopago.com/v1/payments/search");
  searchUrl.searchParams.set("external_reference", externalReference);
  searchUrl.searchParams.set("sort", "date_created");
  searchUrl.searchParams.set("criteria", "desc");
  searchUrl.searchParams.set("limit", "20");

  let searchResponse: Response;
  try {
    searchResponse = await fetch(searchUrl, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }

  if (!searchResponse.ok) return null;

  let payload: MercadoPagoPaymentSearchResponse;
  try {
    payload = (await searchResponse.json()) as MercadoPagoPaymentSearchResponse;
  } catch {
    return null;
  }

  const matches = (Array.isArray(payload.results) ? payload.results : [])
    .filter((item) => {
      const itemReference = safeText(item.external_reference);
      const itemCurrency = safeText(item.currency_id)?.toUpperCase() ?? null;
      const itemAmountMinor = moneyToMinor(item.transaction_amount);
      return (
        itemReference === externalReference &&
        itemCurrency === expectedCurrency.toUpperCase() &&
        itemAmountMinor === expectedAmountMinor
      );
    })
    .sort((left, right) => paymentSearchTimestamp(right) - paymentSearchTimestamp(left));

  const latest = matches[0];
  if (!latest) return null;

  const providerStatus = safeText(latest.status);
  const providerStatusDetail = safeText(latest.status_detail);
  const mapped = mapPaymentSearchStatus(providerStatus, providerStatusDetail);
  if (!mapped) return null;

  return { providerStatus, providerStatusDetail, mapped };
}

const handler = {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

    let payload: ReconcileRequest;
    try {
      payload = (await request.json()) as ReconcileRequest;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const attemptId = safeText(payload.attemptId);
    if (!attemptId || !UUID_PATTERN.test(attemptId)) {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const userClient = context.supabase;
    const adminClient = context.supabaseAdmin;
    const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")?.trim();
    if (!accessToken) return jsonResponse({ error: "mercadopago_not_configured" }, 503);

    const { data: attemptData, error: attemptError } = await userClient
      .from("online_checkout_attempts")
      .select(
        "id,external_reference,provider_order_id,provider_payment_id,amount_minor,currency,status,sale_id,processed_at",
      )
      .eq("id", attemptId)
      .eq("provider", "mercado_pago")
      .maybeSingle();

    if (attemptError) return jsonResponse({ error: "attempt_lookup_failed" }, 500);
    if (!attemptData) return jsonResponse({ error: "attempt_not_found" }, 404);

    const attempt = attemptData as CheckoutAttempt;
    if (!attempt.provider_order_id) {
      return jsonResponse({ ok: true, status: attempt.status, result: "order_not_created" });
    }

    let providerResponse: Response;
    try {
      providerResponse = await fetch(
        `https://api.mercadopago.com/v1/orders/${encodeURIComponent(attempt.provider_order_id)}`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      return jsonResponse({ error: "provider_unreachable" }, 502);
    }

    if (!providerResponse.ok) {
      return jsonResponse({ error: "provider_lookup_failed" }, 502);
    }

    let order: MercadoPagoOrder;
    try {
      order = (await providerResponse.json()) as MercadoPagoOrder;
    } catch {
      return jsonResponse({ error: "provider_response_invalid" }, 502);
    }

    const orderId = safeText(order.id);
    const externalReference = safeText(order.external_reference);
    const providerStatus = safeText(order.status);
    const providerStatusDetail = safeText(order.status_detail);
    const currency = safeText(order.currency)?.toUpperCase() ?? null;
    const totalAmountMinor = moneyToMinor(order.total_amount);
    const totalPaidAmountMinor = moneyToMinor(order.total_paid_amount);
    const payments = Array.isArray(order.transactions?.payments)
      ? order.transactions?.payments
      : [];

    if (
      !orderId ||
      orderId !== attempt.provider_order_id ||
      externalReference !== attempt.external_reference
    ) {
      return jsonResponse({ error: "provider_order_identity_invalid" }, 502);
    }

    if (
      totalAmountMinor !== attempt.amount_minor ||
      !currency ||
      currency !== attempt.currency.toUpperCase()
    ) {
      await adminClient
        .from("online_checkout_attempts")
        .update({
          status: "error",
          provider_status: providerStatus,
          provider_status_detail: providerStatusDetail,
          failure_code: "provider_amount_or_currency_mismatch",
          updated_at: new Date().toISOString(),
        })
        .eq("id", attempt.id)
        .is("processed_at", null);
      return jsonResponse({
        ok: true,
        status: "error",
        result: "provider_amount_or_currency_mismatch",
      });
    }

    const approved =
      providerStatus?.toLowerCase() === "processed" &&
      providerStatusDetail?.toLowerCase() === "accredited";

    if (approved) {
      const payment =
        payments.find(
          (item) =>
            safeText(item.status)?.toLowerCase() === "processed" &&
            safeText(item.status_detail)?.toLowerCase() === "accredited",
        ) ?? payments[0];
      const providerPaymentId = safeText(payment?.id);
      const paymentPaidMinor = moneyToMinor(payment?.paid_amount ?? payment?.amount);
      const paidAmountMinor = totalPaidAmountMinor ?? paymentPaidMinor ?? totalAmountMinor;

      if (!providerPaymentId || paidAmountMinor !== attempt.amount_minor) {
        await adminClient
          .from("online_checkout_attempts")
          .update({
            status: "error",
            provider_status: providerStatus,
            provider_status_detail: providerStatusDetail,
            failure_code: "provider_amount_or_currency_mismatch",
            updated_at: new Date().toISOString(),
          })
          .eq("id", attempt.id)
          .is("processed_at", null);
        return jsonResponse({
          ok: true,
          status: "error",
          result: "provider_amount_or_currency_mismatch",
        });
      }

      const { data: activation, error: activationError } = await adminClient.rpc(
        "service_confirm_online_checkout_approved",
        {
          target_attempt_id: attempt.id,
          target_provider_order_id: orderId,
          target_provider_payment_id: providerPaymentId,
          target_external_reference: externalReference,
          target_provider_status: providerStatus,
          target_provider_status_detail: providerStatusDetail,
          target_paid_amount_minor: paidAmountMinor,
          target_currency: currency,
        },
      );

      if (activationError) return jsonResponse({ error: "activation_failed" }, 500);

      return jsonResponse({
        ok: true,
        status: "approved",
        result: activation?.reused === true ? "approved_reused" : "approved_activated",
        reused: activation?.reused === true,
      });
    }

    if (attempt.processed_at || attempt.sale_id) {
      return jsonResponse({
        ok: true,
        status: "approved",
        result: "approved_preserved",
        reused: true,
      });
    }

    const pendingPayment = payments.find((item) => {
      const status = safeText(item.status)?.toLowerCase();
      return (
        status === "processing" ||
        status === "action_required" ||
        status === "pending" ||
        status === "in_process" ||
        status === "authorized"
      );
    });
    const failedPayment = payments.find((item) => {
      const status = safeText(item.status)?.toLowerCase();
      return status === "failed" || status === "rejected";
    });
    const terminalPayment = payments.find((item) => {
      const status = safeText(item.status)?.toLowerCase();
      return (
        status === "canceled" ||
        status === "cancelled" ||
        status === "expired" ||
        status === "refunded" ||
        status === "charged_back"
      );
    });
    const nonApprovedPayment = pendingPayment ?? failedPayment ?? terminalPayment;
    const paymentStatus = safeText(nonApprovedPayment?.status);
    const paymentStatusDetail = safeText(nonApprovedPayment?.status_detail);
    const usePaymentState =
      providerStatus?.toLowerCase() === "created" &&
      Boolean(paymentStatus && paymentStatus.toLowerCase() !== "created");
    let nonApprovedProviderStatus = usePaymentState ? paymentStatus : providerStatus;
    let nonApprovedProviderStatusDetail = usePaymentState
      ? paymentStatusDetail
      : providerStatusDetail;
    let mapped = mapAttemptStatus(nonApprovedProviderStatus, nonApprovedProviderStatusDetail);

    if (providerStatus?.toLowerCase() === "created" && mapped.status === "order_created") {
      const searchedPayment = await searchNonApprovedPayment(
        accessToken,
        externalReference,
        attempt.amount_minor,
        attempt.currency,
      );
      if (searchedPayment) {
        nonApprovedProviderStatus = searchedPayment.providerStatus;
        nonApprovedProviderStatusDetail = searchedPayment.providerStatusDetail;
        mapped = searchedPayment.mapped;
      }
    }

    const { error: updateError } = await adminClient
      .from("online_checkout_attempts")
      .update({
        status: mapped.status,
        provider_status: nonApprovedProviderStatus,
        provider_status_detail: nonApprovedProviderStatusDetail,
        failure_code: mapped.failureCode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attempt.id)
      .is("processed_at", null);

    if (updateError) return jsonResponse({ error: "attempt_status_update_failed" }, 500);

    return jsonResponse({
      ok: true,
      status: mapped.status,
      result: mapped.status,
      failureCode: mapped.failureCode,
    });
  }),
};

export default handler;
