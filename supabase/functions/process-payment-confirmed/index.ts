import { withSupabase } from "npm:@supabase/server@1.7.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

import {
  buildPaymentConfirmedConditions,
  buildPaymentConfirmedVariables,
  MockMessagingProvider,
  paymentConfirmedCandidateKey,
  paymentConfirmedIdempotencyKey,
  PAYMENT_CONFIRMED_CATALOG_CODE,
  PAYMENT_CONFIRMED_CONSUMER_KEY,
  PAYMENT_CONFIRMED_TEMPLATE,
  type MessagingProviderInput,
  type PaymentConfirmedVariables,
} from "./payment-confirmed.ts";

type ProcessPaymentConfirmedRequest = {
  eventId?: unknown;
};

type ExecutionRow = {
  id: string;
  instance_id: string;
  version_number: number;
  status: string;
  origin_eligibility_evaluation_id: string;
  latest_eligibility_evaluation_id: string;
  last_error_retryable: boolean | null;
};

type InstanceRow = {
  id: string;
  current_version_number: number;
  status: string;
  eligible_from: string | null;
};

type DomainEventRow = {
  event_id: string;
  studio_id: string;
  event_type: string;
  occurred_at: string;
  source_entity_type: string;
  source_entity_id: string;
  payload: Record<string, unknown>;
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

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function requestSnapshot(input: MessagingProviderInput) {
  return {
    recipient: input.recipient,
    template: input.template,
    variables: input.variables,
    execution_id: input.executionId,
    metadata: input.metadata,
  };
}

async function claimEvent(adminClient: SupabaseClient, eventId: string): Promise<boolean> {
  const { error } = await adminClient.rpc("claim_domain_event", {
    p_event_id: eventId,
    p_consumer_key: PAYMENT_CONFIRMED_CONSUMER_KEY,
  });
  return !error;
}

async function loadContext(adminClient: SupabaseClient, event: DomainEventRow) {
  const paymentId = event.source_entity_id;

  const { data: payment, error: paymentError } = await adminClient
    .from("payments")
    .select("id,studio_id,sale_id,kind,amount_minor,method,reference,created_at")
    .eq("id", paymentId)
    .eq("studio_id", event.studio_id)
    .maybeSingle();

  if (paymentError || !payment) {
    return { error: "payment_not_found" as const };
  }

  const { data: sale, error: saleError } = await adminClient
    .from("sales")
    .select("id,studio_id,student_id,folio,status,currency,total_minor")
    .eq("id", payment.sale_id)
    .eq("studio_id", event.studio_id)
    .maybeSingle();

  if (saleError || !sale) {
    return { error: "sale_not_found" as const };
  }

  const { data: student, error: studentError } = sale.student_id
    ? await adminClient
        .from("students")
        .select("id,studio_id,full_name,phone,lifecycle_status,active")
        .eq("id", sale.student_id)
        .eq("studio_id", event.studio_id)
        .maybeSingle()
    : { data: null, error: null };

  if (studentError) {
    return { error: "payment_context_failed" as const };
  }

  const payload = event.payload ?? {};
  const payloadPaymentId = safeText(payload.payment_id);
  const payloadSaleId = safeText(payload.sale_id);
  const payloadStudentId = safeText(payload.student_id);
  const amountMinor = safeInteger(payload.amount_minor);
  const balanceMinor = safeInteger(payload.balance_minor);
  const currency = safeText(payload.currency);
  const method = safeText(payload.method);
  const concept = safeText(payload.concept);
  const packageName = safeText(payload.package);
  const saleFolio = safeText(payload.sale_folio);
  const reference = safeText(payload.reference);

  const eventMatchesPayment =
    payloadPaymentId === payment.id &&
    payloadSaleId === payment.sale_id &&
    amountMinor === Number(payment.amount_minor) &&
    method === safeText(payment.method);

  let variables: PaymentConfirmedVariables | null = null;
  try {
    if (amountMinor !== null && balanceMinor !== null && currency && method && concept) {
      variables = buildPaymentConfirmedVariables({
        amountMinor,
        currency,
        concept,
        method,
        packageName,
        balanceMinor,
      });
    }
  } catch {
    variables = null;
  }

  return {
    payment,
    sale,
    student,
    event,
    snapshot: {
      payment_id: payloadPaymentId,
      sale_id: payloadSaleId,
      student_id: payloadStudentId,
      sale_folio: saleFolio,
      amount_minor: amountMinor,
      currency,
      method,
      reference,
      concept,
      package: packageName,
      balance_minor: balanceMinor,
    },
    eventMatchesPayment,
    variables,
    contextComplete: Boolean(
      variables &&
      payloadStudentId &&
      payloadStudentId === sale.student_id &&
      saleFolio &&
      currency,
    ),
  };
}

async function recordEligibility(
  adminClient: SupabaseClient,
  input: {
    instanceId: string;
    versionNumber: number;
    paymentId: string;
    saleId: string;
    occurredAt: string;
    eventId: string;
    conditions: ReturnType<typeof buildPaymentConfirmedConditions>;
    phase: "initial" | "revalidation";
  },
) {
  const groupKey = `sale:${input.saleId}`;
  const { data, error } = await adminClient.rpc("record_automation_eligibility_evaluation", {
    p_instance_id: input.instanceId,
    p_version_number: input.versionNumber,
    p_candidate_key: paymentConfirmedCandidateKey(input.paymentId),
    p_candidate_occurred_at: input.occurredAt,
    p_phase: input.phase,
    p_conditions: input.conditions,
    p_event_id: input.eventId,
    p_subject_entity_type: "payment",
    p_subject_entity_id: input.paymentId,
    p_metadata: {
      sf_ticket: "SF-176",
      trigger: "payment.confirmed",
      communication_group_key: groupKey,
      combination_candidate: "AUT-CAT-06",
    },
  });

  if (error || !data) return null;
  return data as {
    evaluation_id: string;
    eligible: boolean;
    outcome: "proceed" | "skip" | "cancel";
    exclusion_reasons: unknown[];
  };
}

async function existingExecution(adminClient: SupabaseClient, studioId: string, paymentId: string) {
  const { data } = await adminClient
    .from("automation_executions")
    .select(
      "id,instance_id,version_number,status,origin_eligibility_evaluation_id,latest_eligibility_evaluation_id,last_error_retryable",
    )
    .eq("studio_id", studioId)
    .eq("idempotency_key", paymentConfirmedIdempotencyKey(paymentId))
    .maybeSingle();

  return (data ?? null) as ExecutionRow | null;
}

const handler = {
  fetch: withSupabase({ auth: "none" }, async (request, context) => {
    if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

    const adminClient = context.supabaseAdmin;
    const dispatchToken = safeText(request.headers.get("x-studio-flow-dispatch-token"));

    if (!dispatchToken) return jsonResponse({ error: "unauthenticated" }, 401);

    const { data: dispatchAuthorized, error: dispatchAuthError } = await adminClient.rpc(
      "verify_automation_dispatch_token",
      { p_token: dispatchToken },
    );

    if (dispatchAuthError || dispatchAuthorized !== true) {
      return jsonResponse({ error: "forbidden" }, 403);
    }

    let payload: ProcessPaymentConfirmedRequest;
    try {
      payload = (await request.json()) as ProcessPaymentConfirmedRequest;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const eventId = safeText(payload.eventId);
    if (!eventId || !UUID_PATTERN.test(eventId)) {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const { data: eventData, error: eventError } = await adminClient
      .from("domain_events")
      .select(
        "event_id,studio_id,event_type,occurred_at,source_entity_type,source_entity_id,payload",
      )
      .eq("event_id", eventId)
      .maybeSingle();

    if (eventError || !eventData) {
      return jsonResponse({ error: "payment_event_not_found" }, 404);
    }

    const event = eventData as DomainEventRow;
    if (
      event.event_type !== "payment.confirmed" ||
      event.source_entity_type !== "payment" ||
      !UUID_PATTERN.test(event.source_entity_id)
    ) {
      return jsonResponse({ error: "payment_event_invalid" }, 409);
    }

    const contextData = await loadContext(adminClient, event);
    if ("error" in contextData) {
      return jsonResponse(
        { error: contextData.error },
        contextData.error === "payment_not_found" ? 404 : 409,
      );
    }

    const paymentId = contextData.payment.id;
    const saleId = contextData.sale.id;
    const conditions = buildPaymentConfirmedConditions({
      paymentKind: contextData.payment.kind,
      paymentAmountMinor: Number(contextData.payment.amount_minor),
      saleStatus: contextData.sale.status,
      studentId: contextData.student?.id ?? null,
      recipient: contextData.student?.phone ?? null,
      eventMatchesPayment: contextData.eventMatchesPayment,
      contextComplete: contextData.contextComplete,
    });

    let execution = await existingExecution(adminClient, event.studio_id, paymentId);
    let instance: InstanceRow | null = null;
    let eligibilityEvaluationId: string | null = null;

    if (execution) {
      const { data: existingInstance } = await adminClient
        .from("automation_instances")
        .select("id,current_version_number,status,eligible_from")
        .eq("id", execution.instance_id)
        .maybeSingle();

      instance = (existingInstance ?? null) as InstanceRow | null;
      if (!instance) return jsonResponse({ error: "automation_instance_not_found" }, 409);

      if (execution.status === "accepted") {
        await claimEvent(adminClient, event.event_id);
        return jsonResponse({
          ok: true,
          outcome: "accepted",
          executionId: execution.id,
          reused: true,
        });
      }

      if (execution.status === "suppressed" || execution.status === "cancelled") {
        await claimEvent(adminClient, event.event_id);
        return jsonResponse({
          ok: true,
          outcome: execution.status,
          executionId: execution.id,
          reused: true,
        });
      }

      if (execution.status === "processing" || execution.status === "sent") {
        return jsonResponse({
          ok: true,
          outcome: "in_progress",
          executionId: execution.id,
          reused: true,
        });
      }

      if (execution.status === "error") {
        if (execution.last_error_retryable !== true) {
          await claimEvent(adminClient, event.event_id);
          return jsonResponse({
            ok: true,
            outcome: "error",
            executionId: execution.id,
            retryable: false,
            reused: true,
          });
        }

        const revalidation = await recordEligibility(adminClient, {
          instanceId: execution.instance_id,
          versionNumber: execution.version_number,
          paymentId,
          saleId,
          occurredAt: event.occurred_at,
          eventId: event.event_id,
          conditions,
          phase: "revalidation",
        });

        if (!revalidation) return jsonResponse({ error: "eligibility_failed" }, 500);

        if (!revalidation.eligible || revalidation.outcome !== "proceed") {
          const { error: cancelError } = await adminClient.rpc(
            "system_cancel_automation_execution",
            {
              p_execution_id: execution.id,
              p_revalidation_evaluation_id: revalidation.evaluation_id,
            },
          );

          if (cancelError) return jsonResponse({ error: "execution_cancel_failed" }, 500);
          await claimEvent(adminClient, event.event_id);
          return jsonResponse({
            ok: true,
            outcome: "cancelled",
            executionId: execution.id,
            exclusionReasons: revalidation.exclusion_reasons,
            reused: true,
          });
        }

        eligibilityEvaluationId = revalidation.evaluation_id;
      } else {
        eligibilityEvaluationId = execution.latest_eligibility_evaluation_id;
      }
    } else {
      const { data: activeInstances, error: instanceError } = await adminClient
        .from("automation_instances")
        .select("id,current_version_number,status,eligible_from")
        .eq("studio_id", event.studio_id)
        .eq("catalog_code", PAYMENT_CONFIRMED_CATALOG_CODE)
        .eq("status", "active")
        .limit(2);

      if (instanceError) return jsonResponse({ error: "automation_instance_lookup_failed" }, 500);

      if (!activeInstances?.length) {
        await claimEvent(adminClient, event.event_id);
        return jsonResponse({
          ok: true,
          outcome: "inactive",
          eventId: event.event_id,
        });
      }

      if (activeInstances.length > 1) {
        return jsonResponse({ error: "automation_instance_conflict" }, 409);
      }

      instance = activeInstances[0] as InstanceRow;

      const initial = await recordEligibility(adminClient, {
        instanceId: instance.id,
        versionNumber: instance.current_version_number,
        paymentId,
        saleId,
        occurredAt: event.occurred_at,
        eventId: event.event_id,
        conditions,
        phase: "initial",
      });

      if (!initial) return jsonResponse({ error: "eligibility_failed" }, 500);

      if (!initial.eligible || initial.outcome !== "proceed" || !contextData.variables) {
        await claimEvent(adminClient, event.event_id);
        return jsonResponse({
          ok: true,
          outcome: "skipped",
          eventId: event.event_id,
          exclusionReasons: initial.exclusion_reasons,
        });
      }

      eligibilityEvaluationId = initial.evaluation_id;

      const groupKey = `sale:${saleId}`;
      const { data: executionResult, error: executionError } = await adminClient.rpc(
        "system_create_automation_execution",
        {
          p_eligibility_evaluation_id: initial.evaluation_id,
          p_idempotency_key: paymentConfirmedIdempotencyKey(paymentId),
          p_data_snapshot: {
            ...contextData.snapshot,
            event_id: event.event_id,
            communication_group_key: groupKey,
            combination_candidate: "AUT-CAT-06",
          },
          p_template_snapshot: {
            catalog_code: PAYMENT_CONFIRMED_CATALOG_CODE,
            template: PAYMENT_CONFIRMED_TEMPLATE,
          },
          p_variables_snapshot: contextData.variables,
          p_scheduled_for: null,
        },
      );

      if (executionError || !executionResult) {
        execution = await existingExecution(adminClient, event.studio_id, paymentId);
        if (!execution) return jsonResponse({ error: "execution_create_failed" }, 500);
      } else {
        const created = executionResult as {
          execution_id: string;
          status: string;
          created: boolean;
        };

        execution = {
          id: created.execution_id,
          instance_id: instance.id,
          version_number: instance.current_version_number,
          status: created.status,
          origin_eligibility_evaluation_id: initial.evaluation_id,
          latest_eligibility_evaluation_id: initial.evaluation_id,
          last_error_retryable: null,
        };
      }
    }

    if (!execution || !eligibilityEvaluationId || !instance || !contextData.variables) {
      return jsonResponse({ error: "automation_state_incomplete" }, 500);
    }

    const { data: attemptResult, error: attemptError } = await adminClient.rpc(
      "system_start_automation_execution_attempt",
      {
        p_execution_id: execution.id,
        p_eligibility_evaluation_id: eligibilityEvaluationId,
      },
    );

    if (attemptError || !attemptResult) {
      const concurrent = await existingExecution(adminClient, event.studio_id, paymentId);

      if (concurrent?.status === "accepted") {
        await claimEvent(adminClient, event.event_id);
        return jsonResponse({
          ok: true,
          outcome: "accepted",
          executionId: concurrent.id,
          reused: true,
        });
      }

      if (concurrent?.status === "processing" || concurrent?.status === "sent") {
        return jsonResponse({
          ok: true,
          outcome: "in_progress",
          executionId: concurrent.id,
          reused: true,
        });
      }

      return jsonResponse({ error: "execution_attempt_failed" }, 500);
    }

    const attempt = attemptResult as {
      attempt_id: string;
      attempt_number: number;
    };

    const provider = new MockMessagingProvider();
    const providerInput: MessagingProviderInput = {
      recipient: contextData.student?.phone ?? "",
      template: PAYMENT_CONFIRMED_TEMPLATE,
      variables: contextData.variables,
      executionId: execution.id,
      metadata: {
        catalog_code: PAYMENT_CONFIRMED_CATALOG_CODE,
        event_id: event.event_id,
        payment_id: paymentId,
        sale_id: saleId,
        communication_group_key: `sale:${saleId}`,
        combination_candidate: "AUT-CAT-06",
      },
    };

    let providerResult;
    try {
      providerResult = await provider.send(providerInput);
    } catch {
      const { error: markExceptionError } = await adminClient.rpc(
        "system_mark_automation_execution_error",
        {
          p_attempt_id: attempt.attempt_id,
          p_error_code: "provider_exception",
          p_error_message: "El proveedor simulado lanzó una excepción.",
          p_retryable: true,
        },
      );

      if (markExceptionError) {
        return jsonResponse({ error: "execution_error_persist_failed" }, 500);
      }

      return jsonResponse({
        ok: true,
        outcome: "error",
        executionId: execution.id,
        retryable: true,
      });
    }

    if (providerResult.status === "accepted") {
      const { error: sentError } = await adminClient.rpc("system_mark_automation_execution_sent", {
        p_attempt_id: attempt.attempt_id,
        p_provider_key: provider.key,
        p_request_snapshot: requestSnapshot(providerInput),
      });

      if (sentError) {
        const refreshed = await existingExecution(adminClient, event.studio_id, paymentId);
        if (refreshed?.status !== "sent" && refreshed?.status !== "accepted") {
          await adminClient.rpc("system_mark_automation_execution_error", {
            p_attempt_id: attempt.attempt_id,
            p_error_code: "execution_sent_persist_failed",
            p_error_message: "No se pudo persistir el estado sent del intento.",
            p_retryable: true,
          });
          return jsonResponse({ error: "execution_sent_failed" }, 500);
        }
      }

      const beforeAccept = await existingExecution(adminClient, event.studio_id, paymentId);
      if (beforeAccept?.status !== "accepted") {
        const { error: acceptedError } = await adminClient.rpc(
          "system_mark_automation_execution_accepted",
          {
            p_attempt_id: attempt.attempt_id,
            p_provider_reference: providerResult.providerReference ?? null,
            p_response_snapshot: providerResult.responseSnapshot ?? {},
          },
        );

        if (acceptedError) {
          const refreshed = await existingExecution(adminClient, event.studio_id, paymentId);
          if (refreshed?.status !== "accepted") {
            await adminClient.rpc("system_mark_automation_execution_error", {
              p_attempt_id: attempt.attempt_id,
              p_error_code: "execution_accept_persist_failed",
              p_error_message: "No se pudo persistir la aceptación del proveedor.",
              p_retryable: true,
            });
            return jsonResponse({ error: "execution_accept_failed" }, 500);
          }
        }
      }

      if (!(await claimEvent(adminClient, event.event_id))) {
        const refreshed = await existingExecution(adminClient, event.studio_id, paymentId);
        if (refreshed?.status !== "accepted") {
          return jsonResponse({ error: "domain_event_claim_failed" }, 500);
        }
      }

      return jsonResponse({
        ok: true,
        outcome: "accepted",
        executionId: execution.id,
        attemptNumber: attempt.attempt_number,
        provider: provider.key,
      });
    }

    const { error: markError } = await adminClient.rpc("system_mark_automation_execution_error", {
      p_attempt_id: attempt.attempt_id,
      p_error_code: providerResult.errorCode,
      p_error_message: providerResult.errorMessage,
      p_retryable: providerResult.retryable,
    });

    if (markError) return jsonResponse({ error: "execution_error_persist_failed" }, 500);

    if (!providerResult.retryable) {
      await claimEvent(adminClient, event.event_id);
    }

    return jsonResponse({
      ok: true,
      outcome: "error",
      executionId: execution.id,
      retryable: providerResult.retryable,
    });
  }),
};

export default handler;
