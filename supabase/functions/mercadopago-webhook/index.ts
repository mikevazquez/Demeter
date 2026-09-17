import { createClient } from "npm:@supabase/supabase-js@2";

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

type WebhookBody = {
  id?: unknown;
  action?: unknown;
  type?: unknown;
  data?: {
    id?: unknown;
  };
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

type MappedAttemptStatus = {
  status: string;
  failureCode: string | null;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function signatureParts(value: string | null) {
  const parts = new Map<string, string>();
  for (const rawPart of value?.split(",") ?? []) {
    const [key, ...rest] = rawPart.trim().split("=");
    const normalizedKey = key?.trim();
    const normalizedValue = rest.join("=").trim();
    if (normalizedKey && normalizedValue) parts.set(normalizedKey, normalizedValue);
  }
  return { ts: parts.get("ts") ?? null, v1: parts.get("v1") ?? null };
}

function hexBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(leftHex: string, rightHex: string) {
  const left = hexBytes(leftHex);
  const right = hexBytes(rightHex);
  if (!left || !right || left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validSignature(
  secret: string,
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string | null,
) {
  const { ts, v1 } = signatureParts(xSignature);
  if (!ts || !v1 || !xRequestId || !dataId) return { ok: false, ts };

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = await hmacSha256Hex(secret, manifest);
  return { ok: constantTimeEqual(expected, v1), ts };
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

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")?.trim();
  const webhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET")?.trim();

  if (!supabaseUrl || !serviceRoleKey || !accessToken || !webhookSecret) {
    return jsonResponse({ error: "webhook_not_configured" }, 503);
  }

  const url = new URL(request.url);
  const queryDataId = safeText(url.searchParams.get("data.id") ?? url.searchParams.get("data_id"));
  const queryType = safeText(url.searchParams.get("type"));
  const xRequestId = safeText(request.headers.get("x-request-id"));
  const verification = await validSignature(
    webhookSecret,
    request.headers.get("x-signature"),
    xRequestId,
    queryDataId,
  );

  if (!verification.ok) return jsonResponse({ error: "invalid_signature" }, 401);

  let body: WebhookBody;
  try {
    body = (await request.json()) as WebhookBody;
  } catch {
    return jsonResponse({ error: "invalid_body" }, 400);
  }

  const bodyDataId = safeText(body.data?.id);
  if (!queryDataId || (bodyDataId && bodyDataId !== queryDataId)) {
    return jsonResponse({ error: "order_id_mismatch" }, 400);
  }

  const eventType = safeText(body.type) ?? queryType;
  if (eventType && eventType !== "order" && eventType !== "orders_v2") {
    return jsonResponse({ ok: true, ignored: "unsupported_event_type" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const action = safeText(body.action);
  const providerEventId =
    safeText(body.id) ?? `${xRequestId ?? "no-request"}:${action ?? "order"}:${queryDataId}`;

  const { data: eventRow, error: eventInsertError } = await supabase
    .from("online_checkout_webhook_events")
    .insert({
      provider: "mercado_pago",
      provider_event_id: providerEventId,
      provider_order_id: queryDataId,
      action,
      request_id: xRequestId,
      signature_ts: verification.ts,
      processing_status: "received",
    })
    .select("id")
    .maybeSingle();

  if (eventInsertError && eventInsertError.code !== "23505") {
    return jsonResponse({ error: "webhook_audit_failed" }, 500);
  }

  const processingTask = (async () => {
    const markEvent = async (processingStatus: string, resultCode: string) => {
      if (!eventRow?.id) return;
      await supabase
        .from("online_checkout_webhook_events")
        .update({
          processing_status: processingStatus,
          result_code: resultCode,
          processed_at: new Date().toISOString(),
        })
        .eq("id", eventRow.id);
    };

    let providerResponse: Response;
    try {
      providerResponse = await fetch(
        `https://api.mercadopago.com/v1/orders/${encodeURIComponent(queryDataId)}`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      await markEvent("error", "provider_unreachable");
      return jsonResponse({ error: "provider_unreachable" }, 502);
    }

    if (!providerResponse.ok) {
      await markEvent("error", `provider_http_${providerResponse.status}`);
      return jsonResponse({ error: "provider_lookup_failed" }, 502);
    }

    let order: MercadoPagoOrder;
    try {
      order = (await providerResponse.json()) as MercadoPagoOrder;
    } catch {
      await markEvent("error", "provider_response_invalid");
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

    if (!orderId || orderId !== queryDataId || !externalReference) {
      await markEvent("error", "provider_order_identity_invalid");
      return jsonResponse({ error: "provider_order_identity_invalid" }, 502);
    }

    const { data: attemptData, error: attemptError } = await supabase
      .from("online_checkout_attempts")
      .select(
        "id,external_reference,provider_order_id,provider_payment_id,amount_minor,currency,status,sale_id,processed_at",
      )
      .eq("provider", "mercado_pago")
      .eq("external_reference", externalReference)
      .maybeSingle();

    if (attemptError) {
      await markEvent("error", "attempt_lookup_failed");
      return jsonResponse({ error: "attempt_lookup_failed" }, 500);
    }
    if (!attemptData) {
      await markEvent("ignored", "attempt_not_found");
      return jsonResponse({ ok: true, ignored: "attempt_not_found" });
    }

    const attempt = attemptData as CheckoutAttempt;
    if (attempt.provider_order_id && attempt.provider_order_id !== orderId) {
      await markEvent("error", "provider_order_mismatch");
      return jsonResponse({ error: "provider_order_mismatch" }, 409);
    }

    if (!attempt.provider_order_id) {
      const { error: orderLinkError } = await supabase
        .from("online_checkout_attempts")
        .update({ provider_order_id: orderId, updated_at: new Date().toISOString() })
        .eq("id", attempt.id)
        .is("provider_order_id", null);
      if (orderLinkError) {
        await markEvent("error", "provider_order_link_failed");
        return jsonResponse({ error: "provider_order_link_failed" }, 500);
      }
    }

    const approved =
      providerStatus?.toLowerCase() === "processed" &&
      providerStatusDetail?.toLowerCase() === "accredited";

    if (approved) {
      const payment =
        payments?.find(
          (item) =>
            safeText(item.status)?.toLowerCase() === "processed" &&
            safeText(item.status_detail)?.toLowerCase() === "accredited",
        ) ?? payments?.[0];
      const providerPaymentId = safeText(payment?.id);
      const paymentPaidMinor = moneyToMinor(payment?.paid_amount ?? payment?.amount);
      const paidAmountMinor = totalPaidAmountMinor ?? paymentPaidMinor ?? totalAmountMinor;

      if (
        !providerPaymentId ||
        totalAmountMinor !== attempt.amount_minor ||
        paidAmountMinor !== attempt.amount_minor ||
        !currency ||
        currency !== attempt.currency.toUpperCase()
      ) {
        await supabase
          .from("online_checkout_attempts")
          .update({
            provider_status: providerStatus,
            provider_status_detail: providerStatusDetail,
            last_webhook_at: new Date().toISOString(),
            failure_code: "provider_amount_or_currency_mismatch",
            status: "error",
            updated_at: new Date().toISOString(),
          })
          .eq("id", attempt.id)
          .is("processed_at", null);
        await markEvent("error", "provider_amount_or_currency_mismatch");
        return jsonResponse({
          ok: true,
          result: "provider_amount_or_currency_mismatch",
        });
      }

      const { data: activation, error: activationError } = await supabase.rpc(
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

      if (activationError) {
        await markEvent("error", "activation_failed");
        return jsonResponse({ error: "activation_failed" }, 500);
      }

      await markEvent(
        "processed",
        activation?.reused === true ? "approved_reused" : "approved_activated",
      );
      return jsonResponse({
        ok: true,
        result: "approved",
        reused: activation?.reused === true,
      });
    }

    if (attempt.processed_at || attempt.sale_id) {
      await supabase
        .from("online_checkout_attempts")
        .update({
          provider_status: providerStatus,
          provider_status_detail: providerStatusDetail,
          last_webhook_at: new Date().toISOString(),
          failure_code: `post_approval_${providerStatus ?? "unknown"}_${
            providerStatusDetail ?? "unknown"
          }`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attempt.id);
      await markEvent("processed", "post_approval_state_recorded");
      return jsonResponse({ ok: true, result: "post_approval_state_recorded" });
    }

    const pendingPayment = payments?.find((item) => {
      const status = safeText(item.status)?.toLowerCase();
      return (
        status === "processing" ||
        status === "action_required" ||
        status === "pending" ||
        status === "in_process" ||
        status === "authorized"
      );
    });
    const failedPayment = payments?.find((item) => {
      const status = safeText(item.status)?.toLowerCase();
      return status === "failed" || status === "rejected";
    });
    const terminalPayment = payments?.find((item) => {
      const status = safeText(item.status)?.toLowerCase();
      return (
        status === "canceled" ||
        status === "cancelled" ||
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
    let mapped = mapAttemptStatus(
      nonApprovedProviderStatus,
      nonApprovedProviderStatusDetail,
    );

    if (
      providerStatus?.toLowerCase() === "created" &&
      mapped.status === "order_created"
    ) {
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

    const { error: statusUpdateError } = await supabase
      .from("online_checkout_attempts")
      .update({
        status: mapped.status,
        provider_status: nonApprovedProviderStatus,
        provider_status_detail: nonApprovedProviderStatusDetail,
        last_webhook_at: new Date().toISOString(),
        failure_code: mapped.failureCode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attempt.id)
      .is("processed_at", null);

    if (statusUpdateError) {
      await markEvent("error", "attempt_status_update_failed");
      return jsonResponse({ error: "attempt_status_update_failed" }, 500);
    }

    await markEvent("processed", mapped.status);
    return jsonResponse({ ok: true, result: mapped.status });
  })();

  EdgeRuntime.waitUntil(processingTask);
  return jsonResponse({ ok: true, accepted: true });
});
