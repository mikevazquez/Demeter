import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { demiTestSeller } from "../_shared/demi-mercadopago.ts";

Deno.serve(async (request: Request) => {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!key || !url) return Response.json({ error: "unavailable" }, { status: 503 });
  const client = createClient(url, key, { auth: { persistSession: false } });
  if (request.headers.get("authorization") !== `Bearer ${key}`) {
    const token = request.headers.get("x-studio-flow-dispatch-token");
    if (!token) return Response.json({ error: "forbidden" }, { status: 403 });
    const verified = await client.rpc("verify_automation_dispatch_token", { p_token: token });
    if (verified.error || verified.data !== true)
      return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (request.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  try {
    const body = await request.json();
    const studio = String(body.studio_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(studio)) throw new Error("studio_required");
    const run = await client
      .from("demi_uat_runs")
      .select("id")
      .eq("studio_id", studio)
      .limit(1)
      .maybeSingle();
    if (run.error) throw new Error("uat_scope_lookup_failed");
    const sandbox = new URL(url).hostname === "hedouonyhynuvwbckdlg.supabase.co";
    const capture = sandbox && Boolean(run.data);
    const access = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    const outcomes: Record<string, unknown>[] = [];
    // Signed webhooks use the same native verifier. Reconcile durable requests if a
    // webhook was lost or its background provider lookup failed after acknowledgement.
    if (access && (!sandbox || (await demiTestSeller(access)))) {
      const pending = await client
        .from("demi_payment_requests")
        .select("id,provider_order_id")
        .eq("studio_id", studio)
        .in("status", ["order_created", "pending", "rejected", "error"])
        .not("provider_order_id", "is", null)
        .order("last_checked_at", { ascending: true, nullsFirst: true })
        .limit(10);
      if (pending.error) throw new Error("payment_reconciliation_lookup_failed");
      for (const payment of pending.data ?? []) {
        try {
          const response = await fetch(
            `https://api.mercadopago.com/v1/orders/${encodeURIComponent(payment.provider_order_id)}`,
            {
              headers: { authorization: `Bearer ${access}`, accept: "application/json" },
              signal: AbortSignal.timeout(10000),
            },
          );
          if (!response.ok) {
            outcomes.push({ id: payment.id, error: `provider_http_${response.status}` });
            continue;
          }
          const applied = await client.rpc("service_apply_demi_mercadopago_order", {
            p_request: payment.id,
            p_order: await response.json(),
          });
          outcomes.push({ id: payment.id, reconciliation: applied.error ? "error" : applied.data });
        } catch {
          outcomes.push({ id: payment.id, error: "provider_lookup_failed" });
        }
      }
    }
    const claimed = await client.rpc("service_claim_demi_payment_notifications", {
      p_studio: studio,
    });
    if (claimed.error) throw new Error("payment_notification_claim_failed");
    const reviewed = await client.rpc("service_claim_demi_receipt_review_notices", {
      p_studio: studio,
    });
    if (reviewed.error) throw new Error("receipt_review_notification_claim_failed");
    const jobs = [
      ...(claimed.data ?? []).map((job: Record<string, unknown>) => ({
        ...job,
        review_notice: false,
      })),
      ...(reviewed.data ?? []).map((job: Record<string, unknown>) => ({
        ...job,
        review_notice: true,
      })),
    ];
    for (const payment of jobs) {
      const amount = new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: payment.currency,
      }).format(payment.amount_minor / 100);
      let text = `Mercado Pago confirmó tu pago de ${amount}. No necesitas enviar comprobante. Continúa por este chat con los datos faltantes de quienes asistirán; verificaré el cupo antes de confirmar la reserva. Todavía no hay un lugar retenido.`;
      if (payment.review_notice) text = payment.notification_text;
      let accepted = false;
      let provider: string | null = null;
      let error: string | null = null;
      try {
        if (payment.review_notice) {
          const current = await client.rpc("service_revalidate_demi_receipt_review_notice", {
            p_request: payment.id,
            p_lease: payment.notification_lease,
          });
          if (current.error) throw new Error("receipt_review_revalidation_failed");
          if (!current.data?.eligible) {
            outcomes.push({ id: payment.id, status: "superseded" });
            continue;
          }
        }
        const thread = await client
          .from("assistant_conversations")
          .select("channel,context,external_thread_ref,status,student_id")
          .eq("id", payment.conversation_id)
          .eq("studio_id", studio)
          .single();
        const handoff = await client
          .from("assistant_handoffs")
          .select("id")
          .eq("studio_id", studio)
          .eq("conversation_id", payment.conversation_id)
          .eq("status", "open")
          .limit(1);
        if (thread.error || handoff.error || thread.data.status !== "open" || handoff.data?.length)
          throw new Error("conversation_requires_human_review");
        const identityPerson = thread.data.student_id
          ? await client
              .from("students")
              .select("person_id")
              .eq("studio_id", studio)
              .eq("id", thread.data.student_id)
              .maybeSingle()
          : await client
              .from("crm_contacts")
              .select("person_id")
              .eq("studio_id", studio)
              .eq("id", thread.data.context.crm_contact_id)
              .maybeSingle();
        if (identityPerson.error || !identityPerson.data?.person_id)
          throw new Error("verified_payment_identity_required");
        const preference = await client
          .from("person_communication_preferences")
          .select("whatsapp_blocked")
          .eq("studio_id", studio)
          .eq("person_id", identityPerson.data.person_id)
          .maybeSingle();
        if (preference.error || preference.data?.whatsapp_blocked)
          throw new Error("payment_channel_blocked");
        if (!payment.review_notice) {
          const resumed = await client.rpc("service_resume_demi_paid_group", {
            p_studio: studio,
            p_conversation: payment.conversation_id,
            p_group: payment.group_id,
          });
          if (resumed.error) throw new Error("payment_booking_resume_failed");
          if (resumed.data?.alternative_required === true) {
            text = `Mercado Pago confirmó tu pago de ${amount}. El horario que solicitaste ya no está disponible. Tu pago se conserva; podemos elegir otro horario disponible y ayudarte a agendar, sin volver a cobrarte.`;
          }
          const group = await client
            .from("demi_group_bookings")
            .select("status,participant_count")
            .eq("id", payment.group_id)
            .eq("studio_id", studio)
            .single();
          const participants = await client
            .from("demi_group_participants")
            .select("reservation_id")
            .eq("group_id", payment.group_id);
          if (group.error || participants.error)
            throw new Error("payment_booking_context_unavailable");
          const ids = (participants.data ?? []).map((item) => item.reservation_id).filter(Boolean);
          if (ids.length) {
            const reservations = await client
              .from("reservations")
              .select("id,status")
              .eq("studio_id", studio)
              .in("id", ids);
            if (reservations.error) throw new Error("payment_booking_context_unavailable");
            const reserved = (reservations.data ?? []).filter(
              (item) => item.status === "reserved",
            ).length;
            text = `Mercado Pago confirmó tu pago de ${amount}. No necesitas enviar comprobante. Hay ${reserved} de ${group.data.participant_count} reservas activas para esta solicitud; puedes consultar sus detalles por este chat.`;
            if (reserved > 0) {
              const details = await client.rpc("service_get_demi_group_class_details", {
                p_studio: studio,
                p_conversation: payment.conversation_id,
                p_group: payment.group_id,
              });
              if (details.error || !details.data)
                throw new Error("payment_class_details_unavailable");
              const d = details.data;
              text += `\n${d.activity}: ${d.date}, de ${d.starts_at_local} a ${d.ends_at_local}.`;
              if (d.location) text += `\nSede: ${d.location}.`;
              if (d.address) text += `\nDirección: ${d.address}.`;
            }
          }
        }
        if (capture) {
          const captured = await client.rpc("service_capture_demi_uat_delivery", {
            p_studio: studio,
            p_kind: payment.review_notice ? "demi_receipt_review" : "demi_payment_confirmation",
            p_payload: {
              request_id: payment.id,
              source_kind: payment.source_kind ?? null,
              source_id: payment.source_id ?? null,
              decision: payment.decision ?? null,
              channel: thread.data.channel,
              text,
              attempt: payment.notification_attempts,
            },
          });
          if (captured.error) throw new Error("payment_notification_capture_failed");
          accepted = !captured.data?.failed;
          provider = accepted ? `uat:${captured.data.artifact_id}` : null;
          error = accepted ? null : "demi_uat_injected_delivery_failure";
        } else {
          const lastInbound = await client
            .from("assistant_turns")
            .select("created_at")
            .eq("studio_id", studio)
            .eq("conversation_id", payment.conversation_id)
            .eq("role", "user")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (
            lastInbound.error ||
            !lastInbound.data ||
            Date.now() - Date.parse(lastInbound.data.created_at) >= 24 * 3600 * 1000
          )
            throw new Error("messaging_window_expired");
          const mode = await client
            .from("assistant_configs")
            .select("mode")
            .eq("studio_id", studio)
            .single();
          if (mode.error) throw new Error("assistant_mode_unavailable");
          let endpoint: string;
          let token: string;
          let payload: Record<string, unknown>;
          if (thread.data.channel === "whatsapp") {
            const config = await client.rpc("service_get_meta_whatsapp_webhook_config", {
              target_studio_id: studio,
            });
            const pilot = await client.rpc("service_get_meta_whatsapp_pilot_wa_ids", {
              target_studio_id: studio,
            });
            const recipient = thread.data.external_thread_ref;
            if (
              config.error ||
              pilot.error ||
              !config.data?.access_token ||
              !config.data?.phone_number_id ||
              !/^[1-9][0-9]{7,14}$/.test(recipient ?? "")
            )
              throw new Error("verified_whatsapp_recipient_required");
            if (
              mode.data.mode !== "active" &&
              !(mode.data.mode === "pilot" && (pilot.data ?? []).includes(recipient))
            )
              throw new Error("assistant_channel_not_active");
            token = config.data.access_token;
            endpoint = `https://graph.facebook.com/${config.data.graph_api_version}/${config.data.phone_number_id}/messages`;
            payload = {
              messaging_product: "whatsapp",
              to: recipient,
              type: "text",
              text: { body: text },
            };
          } else if (["facebook_messenger", "instagram"].includes(thread.data.channel)) {
            const config = await client.rpc("service_get_meta_inbox_webhook_config", {
              target_studio_id: studio,
            });
            const identity = await client
              .from("assistant_channel_identities")
              .select("provider_account_id,provider_contact_id")
              .eq("studio_id", studio)
              .eq("id", thread.data.context.identity_id)
              .eq("provider", thread.data.channel)
              .maybeSingle();
            if (
              config.error ||
              identity.error ||
              !identity.data ||
              identity.data.provider_account_id !== thread.data.context.provider_account_id ||
              identity.data.provider_contact_id !== thread.data.context.provider_contact_id
            )
              throw new Error("verified_meta_recipient_required");
            const recipient = identity.data.provider_contact_id;
            const instagram = thread.data.channel === "instagram";
            const account = instagram ? config.data?.instagram_user_id : config.data?.page_id;
            token = instagram
              ? config.data?.instagram_access_token
              : config.data?.page_access_token;
            if (!token || account !== identity.data.provider_account_id)
              throw new Error("meta_account_mismatch");
            if (
              mode.data.mode !== "active" &&
              !(
                mode.data.mode === "pilot" &&
                (config.data?.pilot_contact_ids?.[thread.data.channel] ?? []).includes(recipient)
              )
            )
              throw new Error("assistant_channel_not_active");
            endpoint = `https://${instagram ? "graph.instagram.com" : "graph.facebook.com"}/${config.data.graph_api_version}/${account}/messages`;
            payload = {
              recipient: { id: recipient },
              message: { text },
              ...(instagram ? {} : { messaging_type: "RESPONSE" }),
            };
          } else throw new Error("unsupported_payment_notification_channel");
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15000),
          });
          const result = await response.json();
          provider = result.messages?.[0]?.id ?? result.message_id ?? null;
          accepted = response.ok && typeof provider === "string" && Boolean(provider);
          error = accepted ? null : `meta_${response.status}`;
        }
      } catch (failure) {
        // A transport exception may occur after Meta accepted the send. Keep the
        // lease; the next worker persists review rather than duplicating the message.
        if (
          failure instanceof Error &&
          ["TimeoutError", "AbortError", "TypeError", "SyntaxError"].includes(failure.name)
        ) {
          outcomes.push({ id: payment.id, status: "unknown" });
          continue;
        }
        error = failure instanceof Error ? failure.message : "payment_notification_failed";
      }
      const finished = await client.rpc(
        payment.review_notice
          ? "service_finish_demi_receipt_review_notice"
          : "service_finish_demi_payment_notification",
        {
          p_request: payment.id,
          p_lease: payment.notification_lease,
          p_accepted: accepted,
          p_provider: provider,
          p_error: error,
          p_text: text,
        },
      );
      if (finished.error) throw new Error("payment_notification_result_failed");
      outcomes.push({ id: payment.id, notification: finished.data });
    }
    return Response.json({ outcomes, transport: capture ? "captured" : "meta" });
  } catch (failure) {
    return Response.json(
      { error: failure instanceof Error ? failure.message : "payment_worker_failed" },
      { status: 500 },
    );
  }
});
