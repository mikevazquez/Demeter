import { createClient } from "npm:@supabase/supabase-js@2";
import { withSupabase } from "npm:@supabase/server";

type CreateOrderRequest = {
  productTemplateId?: unknown;
  sessionId?: unknown;
  clientRequestKey?: unknown;
  returnBaseUrl?: unknown;
  evaluationInvitationId?: unknown;
  evaluationSessionId?: unknown;
};

type CheckoutAttempt = {
  id: string;
  external_reference: string;
  product_template_id: string;
  session_id: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  provider_order_id: string | null;
  checkout_url: string | null;
  extra_fulfillment_snapshot?: {
    type?: unknown;
    name?: unknown;
    price_minor?: unknown;
  } | null;
  created_at: string;
};

type MercadoPagoOrderResponse = {
  id?: unknown;
  checkout_url?: unknown;
  external_reference?: unknown;
  status?: unknown;
  status_detail?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function moneyFromMinor(amountMinor: number) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return null;
  return (amountMinor / 100).toFixed(2);
}

function safeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validPayerEmail(value: unknown) {
  const email = safeText(value)?.toLowerCase() ?? null;
  if (!email || email.length > 254 || email.endsWith(".invalid")) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function validReturnBaseUrl(value: unknown) {
  const raw = safeText(value);
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.username || url.password) return null;

  const hostname = url.hostname.toLowerCase();
  const approvedHost =
    hostname === "demeterbueno.vercel.app" ||
    (hostname.startsWith("demeterbueno-") && hostname.endsWith("-demeter3.vercel.app"));

  return approvedHost ? url.origin : null;
}

const handler = {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

    const userClient = context.supabase;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "checkout_not_configured" }, 503);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) return jsonResponse({ error: "unauthenticated" }, 401);

    let payload: CreateOrderRequest;
    try {
      payload = (await request.json()) as CreateOrderRequest;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const productTemplateId = safeText(payload.productTemplateId);
    const sessionId = safeText(payload.sessionId);
    const clientRequestKey = safeText(payload.clientRequestKey);
    const returnBaseUrl = validReturnBaseUrl(payload.returnBaseUrl);
    const evaluationInvitationId = safeText(payload.evaluationInvitationId);
    const evaluationSessionId = safeText(payload.evaluationSessionId);
    const hasEvaluationContext = Boolean(evaluationInvitationId || evaluationSessionId);
    const buyingSingleClass = Boolean(sessionId);

    if (
      !clientRequestKey ||
      !returnBaseUrl ||
      !UUID_PATTERN.test(clientRequestKey) ||
      (buyingSingleClass && (!sessionId || !UUID_PATTERN.test(sessionId))) ||
      (!buyingSingleClass && (!productTemplateId || !UUID_PATTERN.test(productTemplateId))) ||
      (buyingSingleClass && Boolean(productTemplateId)) ||
      (hasEvaluationContext &&
        (!evaluationInvitationId ||
          !evaluationSessionId ||
          !UUID_PATTERN.test(evaluationInvitationId) ||
          !UUID_PATTERN.test(evaluationSessionId))) ||
      (buyingSingleClass && hasEvaluationContext && evaluationSessionId !== sessionId)
    ) {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const { data: attemptData, error: attemptError } = hasEvaluationContext
      ? await userClient.rpc("student_create_evaluation_checkout_attempt", {
          target_invitation_id: evaluationInvitationId,
          target_session_id: evaluationSessionId,
          target_product_template_id: productTemplateId,
          target_client_request_key: clientRequestKey,
        })
      : buyingSingleClass
        ? await userClient.rpc("student_create_single_class_checkout_attempt", {
            target_session_id: sessionId,
            target_client_request_key: clientRequestKey,
          })
        : await userClient.rpc("student_create_online_checkout_attempt", {
            target_product_template_id: productTemplateId,
            target_client_request_key: clientRequestKey,
          });

    if (attemptError || !attemptData) {
      const message = attemptError?.message ?? "checkout_attempt_failed";
      if (message.includes("product_not_available_online")) {
        return jsonResponse({ error: "product_not_available_online" }, 409);
      }
      if (message.includes("single_class_product_not_available")) {
        return jsonResponse({ error: "single_class_product_not_available" }, 409);
      }
      if (message.includes("single_class_price_missing")) {
        return jsonResponse({ error: "single_class_price_missing" }, 409);
      }
      if (message.includes("session_full")) {
        return jsonResponse({ error: "session_full" }, 409);
      }
      if (message.includes("session_not_bookable")) {
        return jsonResponse({ error: "session_not_bookable" }, 409);
      }
      if (
        message.includes("request_key_reused_for_different_product") ||
        message.includes("request_key_reused_for_different_purchase")
      ) {
        return jsonResponse({ error: "request_key_reused_for_different_product" }, 409);
      }
      return jsonResponse({ error: "checkout_attempt_failed" }, 500);
    }

    const attempt = attemptData as CheckoutAttempt;

    const markAttemptFailure = async (
      code: string,
      providerStatus: string | null = null,
      providerStatusDetail: string | null = null,
    ) => {
      await adminClient
        .from("online_checkout_attempts")
        .update({
          status: "error",
          provider_status: providerStatus,
          provider_status_detail: providerStatusDetail,
          failure_code: code,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attempt.id)
        .eq("provider", "mercado_pago");
    };

    if (attempt.provider_order_id && attempt.checkout_url) {
      return jsonResponse({
        ok: true,
        attemptId: attempt.id,
        orderId: attempt.provider_order_id,
        checkoutUrl: attempt.checkout_url,
        status: attempt.status,
        reused: true,
      });
    }

    const [
      { data: attemptRow, error: attemptLookupError },
      { data: product, error: productError },
    ] = await Promise.all([
      adminClient
        .from("online_checkout_attempts")
        .select(
          "id,studio_id,student_id,product_template_id,session_id,client_request_key,external_reference,amount_minor,currency,status,provider_order_id,checkout_url,extra_fulfillment_snapshot",
        )
        .eq("id", attempt.id)
        .maybeSingle(),
      adminClient
        .from("product_templates")
        .select("id,studio_id,name,active,online_purchasable,product_type")
        .eq("id", attempt.product_template_id)
        .maybeSingle(),
    ]);

    if (attemptLookupError || productError || !attemptRow || !product) {
      await markAttemptFailure("checkout_context_failed");
      return jsonResponse({ error: "checkout_context_failed" }, 500);
    }

    const isEvaluationEnrollment =
      hasEvaluationContext && String(product.product_type) === "enrollment";

    if (
      attemptRow.product_template_id !== product.id ||
      attemptRow.studio_id !== product.studio_id ||
      product.active !== true ||
      (product.online_purchasable !== true && !isEvaluationEnrollment) ||
      !["package", "membership", "single_class", "enrollment"].includes(
        String(product.product_type),
      )
    ) {
      await markAttemptFailure("product_not_available_online");
      return jsonResponse({ error: "product_not_available_online" }, 409);
    }

    if (attemptRow.provider_order_id && attemptRow.checkout_url) {
      return jsonResponse({
        ok: true,
        attemptId: attemptRow.id,
        orderId: attemptRow.provider_order_id,
        checkoutUrl: attemptRow.checkout_url,
        status: attemptRow.status,
        reused: true,
      });
    }

    const { data: student, error: studentError } = await adminClient
      .from("students")
      .select("id,email")
      .eq("id", attemptRow.student_id)
      .maybeSingle();

    if (studentError || !student || student.id !== attemptRow.student_id) {
      await markAttemptFailure("student_context_failed");
      return jsonResponse({ error: "student_context_failed" }, 500);
    }

    const payerEmail = validPayerEmail(student.email);
    const totalAmount = moneyFromMinor(attemptRow.amount_minor);
    if (!totalAmount) {
      await markAttemptFailure("online_price_invalid");
      return jsonResponse({ error: "online_price_invalid" }, 409);
    }

    const extraSnapshot =
      attemptRow.extra_fulfillment_snapshot &&
      typeof attemptRow.extra_fulfillment_snapshot === "object"
        ? attemptRow.extra_fulfillment_snapshot
        : null;
    const extraName = safeText(extraSnapshot?.name);
    const extraPriceMinor =
      typeof extraSnapshot?.price_minor === "number" &&
      Number.isInteger(extraSnapshot.price_minor) &&
      extraSnapshot.price_minor > 0
        ? extraSnapshot.price_minor
        : 0;
    const mainPriceMinor = attemptRow.amount_minor - extraPriceMinor;
    const mainAmount = moneyFromMinor(mainPriceMinor);
    const extraAmount = extraPriceMinor ? moneyFromMinor(extraPriceMinor) : null;

    if (!mainAmount || (extraPriceMinor && (!extraName || !extraAmount))) {
      await markAttemptFailure("online_price_invalid");
      return jsonResponse({ error: "online_price_invalid" }, 409);
    }

    const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")?.trim();
    if (!accessToken) {
      await markAttemptFailure("mercadopago_not_configured");
      return jsonResponse({ error: "mercadopago_not_configured" }, 503);
    }

    const returnPath = hasEvaluationContext
      ? `/student/evaluaciones/${evaluationInvitationId}/checkout`
      : attemptRow.session_id
        ? "/student/reservar/checkout"
        : "/student/paquete/checkout";
    const returnUrl = new URL(returnPath, returnBaseUrl);
    returnUrl.searchParams.set("attempt", attemptRow.id);
    if (hasEvaluationContext && evaluationSessionId) {
      returnUrl.searchParams.set("session", evaluationSessionId);
    }

    const successUrl = new URL(returnUrl);
    successUrl.searchParams.set("outcome", "success");
    const failureUrl = new URL(returnUrl);
    failureUrl.searchParams.set("outcome", "failure");
    const pendingUrl = new URL(returnUrl);
    pendingUrl.searchParams.set("outcome", "pending");

    const orderBody: Record<string, unknown> = {
      type: "online",
      processing_mode: "manual",
      total_amount: totalAmount,
      external_reference: attemptRow.external_reference,
      description: product.name,
      ...(payerEmail ? { payer: { email: payerEmail } } : {}),
      config: {
        online: {
          success_url: successUrl.toString(),
          failure_url: failureUrl.toString(),
          pending_url: pendingUrl.toString(),
          auto_return: "all",
        },
      },
      items: [
        {
          title: product.name,
          unit_price: mainAmount,
          quantity: 1,
        },
        ...(extraName && extraAmount
          ? [
              {
                title: extraName,
                unit_price: extraAmount,
                quantity: 1,
              },
            ]
          : []),
      ],
    };

    let mercadoPagoResponse: Response;
    try {
      mercadoPagoResponse = await fetch("https://api.mercadopago.com/v1/orders", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
          "x-idempotency-key": attemptRow.client_request_key,
        },
        body: JSON.stringify(orderBody),
      });
    } catch {
      await markAttemptFailure("mercadopago_unreachable");
      return jsonResponse({ error: "mercadopago_unreachable" }, 502);
    }

    let providerBody: MercadoPagoOrderResponse = {};
    try {
      providerBody = (await mercadoPagoResponse.json()) as MercadoPagoOrderResponse;
    } catch {
      providerBody = {};
    }

    const providerOrderId = safeText(providerBody.id);
    const checkoutUrl = safeText(providerBody.checkout_url);
    const providerExternalReference = safeText(providerBody.external_reference);
    const providerStatus = safeText(providerBody.status);
    const providerStatusDetail = safeText(providerBody.status_detail);

    if (!mercadoPagoResponse.ok || !providerOrderId || !checkoutUrl) {
      await adminClient
        .from("online_checkout_attempts")
        .update({
          status: "error",
          provider_status: providerStatus,
          provider_status_detail: providerStatusDetail,
          failure_code: `mercadopago_http_${mercadoPagoResponse.status}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attemptRow.id)
        .eq("provider", "mercado_pago");

      return jsonResponse(
        { error: "mercadopago_order_failed", providerStatus: mercadoPagoResponse.status },
        502,
      );
    }

    if (providerExternalReference !== attemptRow.external_reference) {
      await markAttemptFailure(
        "mercadopago_reference_mismatch",
        providerStatus,
        providerStatusDetail,
      );
      return jsonResponse({ error: "mercadopago_reference_mismatch" }, 502);
    }

    const { data: updatedAttempt, error: updateError } = await adminClient
      .from("online_checkout_attempts")
      .update({
        provider_order_id: providerOrderId,
        checkout_url: checkoutUrl,
        status: "order_created",
        provider_status: providerStatus,
        provider_status_detail: providerStatusDetail,
        failure_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attemptRow.id)
      .eq("provider", "mercado_pago")
      .select("id,provider_order_id,checkout_url,status")
      .single();

    if (updateError || !updatedAttempt) {
      return jsonResponse({ error: "checkout_persist_failed" }, 500);
    }

    return jsonResponse({
      ok: true,
      attemptId: updatedAttempt.id,
      orderId: updatedAttempt.provider_order_id,
      checkoutUrl: updatedAttempt.checkout_url,
      status: updatedAttempt.status,
      reused: false,
    });
  }),
};

export default handler;
