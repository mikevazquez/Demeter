import { createClient } from "npm:@supabase/supabase-js@2.116.0";

Deno.serve(async (request: Request) => {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!key || !url) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const client = createClient(url, key, { auth: { persistSession: false } });
  const serviceRequest = request.headers.get("authorization") === `Bearer ${key}`;
  if (!serviceRequest) {
    const token = request.headers.get("x-studio-flow-dispatch-token");
    if (!token) return Response.json({ error: "unauthenticated" }, { status: 401 });
    const checked = await client.rpc("verify_automation_dispatch_token", { p_token: token });
    if (checked.error || checked.data !== true)
      return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (request.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  try {
    const body = await request.json();
    const studio = String(body.studio_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(studio))
      return Response.json({ error: "studio_required" }, { status: 400 });
    const sandbox = new URL(url).hostname === "hedouonyhynuvwbckdlg.supabase.co";
    const run = await client
      .from("demi_uat_runs")
      .select("id")
      .eq("studio_id", studio)
      .limit(1)
      .maybeSingle();
    if (run.error) throw new Error("uat_scope_lookup_failed");
    const capture = sandbox && Boolean(run.data);
    if (body.as_of && !capture)
      return Response.json({ error: "uat_clock_required" }, { status: 403 });
    const now = body.as_of ? new Date(body.as_of).toISOString() : new Date().toISOString();
    const seeded = await client.rpc("service_seed_due_demi_followups", {
      p_studio: studio,
      p_now: now,
    });
    if (seeded.error) throw new Error("followup_source_scan_failed");
    const claimed = await client.rpc("service_claim_demi_followups", {
      p_studio: studio,
      p_now: now,
      p_limit: 25,
    });
    if (claimed.error) throw new Error("followup_claim_failed");
    const outcomes: Record<string, unknown>[] = [];
    for (const job of claimed.data ?? []) {
      let accepted = false;
      let provider: string | null = null;
      let error: string | null = null;
      let sendStarted = false;
      try {
        // Check the lease and stop conditions immediately before calling Meta.
        const check = await client.rpc("service_revalidate_demi_followup", {
          p_id: job.id,
          p_token: job.lease_token,
          p_now: now,
        });
        if (check.error) throw new Error("followup_revalidation_failed");
        if (!check.data?.eligible) {
          outcomes.push({ id: job.id, status: "cancelled", reason: check.data?.reason_code });
          continue;
        }
        if (capture) {
          const result = await client.rpc("service_capture_demi_uat_delivery", {
            p_studio: studio,
            p_kind: "demi_followup",
            p_payload: {
              followup_id: job.id,
              kind: job.kind,
              step: job.step,
              attempt: job.attempt_count,
              captured: true,
            },
          });
          if (result.error) throw new Error("followup_capture_failed");
          accepted = !result.data?.failed;
          provider = accepted ? `uat:${result.data.artifact_id}` : null;
          error = accepted ? null : "demi_uat_injected_delivery_failure";
        } else {
          const settings = await client
            .from("demi_followup_settings")
            .select("templates")
            .eq("studio_id", studio)
            .single();
          const thread = await client
            .from("assistant_conversations")
            .select("channel,external_thread_ref")
            .eq("studio_id", studio)
            .eq("id", job.conversation_id)
            .single();
          const config = await client.rpc("service_get_meta_whatsapp_webhook_config", {
            target_studio_id: studio,
          });
          const pilot = await client.rpc("service_get_meta_whatsapp_pilot_wa_ids", {
            target_studio_id: studio,
          });
          const assistant = await client
            .from("assistant_configs")
            .select("mode")
            .eq("studio_id", studio)
            .single();
          if (settings.error || thread.error || config.error || pilot.error || assistant.error)
            throw new Error("meta_context_unavailable");
          const template = settings.data.templates?.[`${job.kind}_${job.step}`];
          const recipient = thread.data.external_thread_ref;
          if (thread.data.channel !== "whatsapp" || !/^[1-9][0-9]{7,14}$/.test(recipient ?? ""))
            throw new Error("verified_whatsapp_recipient_required");
          if (
            assistant.data.mode !== "active" &&
            !(assistant.data.mode === "pilot" && (pilot.data ?? []).includes(recipient))
          )
            throw new Error("assistant_channel_not_active");
          if (!template?.name || !config.data?.access_token || !config.data?.phone_number_id)
            throw new Error("approved_template_required");
          sendStarted = true;
          const result = await fetch(
            `https://graph.facebook.com/${config.data.graph_api_version}/${config.data.phone_number_id}/messages`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${config.data.access_token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: recipient,
                type: "template",
                template: {
                  name: template.name,
                  language: { code: template.language ?? config.data.language_code ?? "es_MX" },
                  components: template.components ?? [],
                },
              }),
              signal: AbortSignal.timeout(20000),
            },
          );
          const payload = await result.json();
          accepted = result.ok && Boolean(payload.messages?.[0]?.id);
          if (!accepted && (result.ok || !payload.error?.code))
            throw new Error("delivery_outcome_unknown");
          sendStarted = false;
          provider = accepted ? payload.messages[0].id : null;
          error = accepted ? null : `meta_${payload.error?.code ?? result.status}`;
        }
      } catch (failure) {
        // An interrupted send or unacknowledged response may already have reached Meta.
        // The persisted lease expires into a human case, without another send.
        if (sendStarted) {
          outcomes.push({ id: job.id, status: "unknown", code: "delivery_outcome_unknown" });
          continue;
        }
        error = failure instanceof Error ? failure.message : "followup_delivery_failed";
      }
      const finished = await client.rpc("service_finish_demi_followup", {
        p_id: job.id,
        p_token: job.lease_token,
        p_accepted: accepted,
        p_provider: provider,
        p_error: error,
        p_now: now,
      });
      if (finished.error) throw new Error("followup_result_persistence_failed");
      outcomes.push({ id: job.id, ...finished.data });
    }
    return Response.json({ outcomes, transport: capture ? "captured" : "meta_whatsapp" });
  } catch (failure) {
    return Response.json(
      { error: failure instanceof Error ? failure.message : "followup_worker_failed" },
      { status: 500 },
    );
  }
});
