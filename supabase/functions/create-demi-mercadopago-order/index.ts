import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { demiCheckoutUrl, demiOrderBody, demiTestSeller } from "../_shared/demi-mercadopago.ts";

Deno.serve(async (request: Request) => {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!key || !url) return Response.json({ error: "forbidden" }, { status: 403 });
  const client = createClient(url, key, { auth: { persistSession: false } });
  if (request.headers.get("authorization") !== `Bearer ${key}`) {
    const dispatch = request.headers.get("x-studio-flow-dispatch-token");
    if (!dispatch) return Response.json({ error: "forbidden" }, { status: 403 });
    const verified = await client.rpc("verify_automation_dispatch_token", { p_token: dispatch });
    if (verified.error || verified.data !== true)
      return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (request.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if (!token) return Response.json({ error: "mercadopago_credentials_required" }, { status: 503 });
  // Never create a checkout using live credentials on the Sandbox project.
  const sandbox = new URL(url).hostname === "hedouonyhynuvwbckdlg.supabase.co";
  try {
    if (sandbox && !(await demiTestSeller(token)))
      return Response.json({ error: "mercadopago_test_seller_required" }, { status: 409 });
    const body = await request.json();
    const prepared = await client.rpc("service_prepare_demi_mercadopago", {
      p_studio: body.studio_id,
      p_conversation: body.conversation_id,
      p_group: body.group_id,
    });
    if (prepared.error) throw new Error("payment_request_prepare_failed");
    const payment = prepared.data;
    if (payment?.ok !== true)
      return Response.json(
        { error: payment?.reason_code ?? "payment_request_prepare_failed" },
        { status: 409 },
      );
    if (payment.checkout_url && payment.provider_order_id)
      return Response.json({
        ok: true,
        request_id: payment.request_id,
        status: payment.status,
        external_checkout: {
          provider: "mercado_pago",
          url: payment.checkout_url,
          receipt_required: false,
          automatic_verification: true,
          test_only: sandbox,
        },
      });
    if (payment.status !== "created")
      return Response.json({ error: "payment_request_requires_review" }, { status: 409 });
    const result = await fetch("https://api.mercadopago.com/v1/orders", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-idempotency-key": `${payment.request_id}-order-v2`,
      },
      body: JSON.stringify(demiOrderBody(payment)),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) {
      const rejected = await result.json().catch(() => ({}));
      const codes = [
        rejected.code,
        rejected.error,
        ...(Array.isArray(rejected.errors)
          ? rejected.errors.map((item: { code?: unknown }) => item.code)
          : []),
      ].filter(
        (item): item is string => typeof item === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(item),
      );
      const fields = Array.isArray(rejected.errors)
        ? rejected.errors
            .flatMap((item: { details?: unknown }) =>
              Array.isArray(item.details)
                ? item.details.map(
                    (detail: { field?: unknown; property?: unknown }) =>
                      detail.field ?? detail.property,
                  )
                : [],
            )
            .filter(
              (item: unknown): item is string =>
                typeof item === "string" && /^[a-zA-Z0-9_.\[\]]{1,100}$/.test(item),
            )
        : [];
      const context = JSON.stringify(rejected.errors ?? rejected.message ?? [])
        .replace(/(?:APP_USR|TEST)-[^\s"']+/g, "[redacted]")
        .slice(0, 1200);
      await client
        .from("demi_payment_requests")
        .update({ failure_code: `provider_http_${result.status}` })
        .eq("id", payment.request_id)
        .is("provider_order_id", null);
      return Response.json(
        {
          error: "provider_order_creation_failed",
          provider_http_status: result.status,
          provider_error_codes: codes,
          provider_error_fields: fields,
          provider_error_context: context,
        },
        { status: 502 },
      );
    }
    const order = await result.json();
    const checkout = demiCheckoutUrl(order.checkout_url);
    if (
      typeof order.id !== "string" ||
      !order.id ||
      order.external_reference !== payment.external_reference ||
      !checkout
    )
      throw new Error("provider_order_response_invalid");
    const saved = await client
      .from("demi_payment_requests")
      .update({
        provider_order_id: order.id,
        checkout_url: checkout,
        status: "order_created",
        failure_code: null,
      })
      .eq("id", payment.request_id)
      .is("provider_order_id", null)
      .is("verified_at", null);
    if (saved.error) throw new Error("provider_order_persistence_failed");
    return Response.json({
      ok: true,
      request_id: payment.request_id,
      status: "order_created",
      external_checkout: {
        provider: "mercado_pago",
        url: checkout,
        receipt_required: false,
        automatic_verification: true,
        test_only: sandbox,
      },
    });
  } catch (failure) {
    return Response.json(
      {
        error:
          failure instanceof Error && failure.name === "Error"
            ? failure.message
            : "provider_order_outcome_unknown",
      },
      { status: 502 },
    );
  }
});
