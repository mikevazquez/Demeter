import { withSupabase } from "npm:@supabase/server@1.7.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

import {
  buildReservationConfirmedConditions,
  buildReservationConfirmedVariables,
  MockMessagingProvider,
  reservationConfirmedCandidateKey,
  reservationConfirmedIdempotencyKey,
  RESERVATION_CONFIRMED_CATALOG_CODE,
  RESERVATION_CONFIRMED_CONSUMER_KEY,
  RESERVATION_CONFIRMED_TEMPLATE,
  type MessagingProviderInput,
} from "./reservation-confirmed.ts";

type ProcessBookingCreatedRequest = {
  reservationId?: unknown;
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

function joinName(firstName: unknown, lastName: unknown) {
  return [safeText(firstName), safeText(lastName)].filter(Boolean).join(" ") || null;
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
    p_consumer_key: RESERVATION_CONFIRMED_CONSUMER_KEY,
  });
  return !error;
}

async function callerCanProcess(
  userClient: SupabaseClient,
  userId: string,
  studioId: string,
  reservationStudentUserId: string | null,
) {
  if (reservationStudentUserId === userId) return true;

  const { data: membership, error: membershipError } = await userClient
    .from("studio_memberships")
    .select("role,active")
    .eq("studio_id", studioId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (membershipError || !membership) return false;

  const { data: capability, error: capabilityError } = await userClient
    .from("role_capabilities")
    .select("capability_key")
    .eq("role", membership.role)
    .eq("capability_key", "schedule.write")
    .maybeSingle();

  return !capabilityError && Boolean(capability);
}

async function loadContext(adminClient: SupabaseClient, reservationId: string) {
  const { data: reservation, error: reservationError } = await adminClient
    .from("reservations")
    .select(
      "id,studio_id,session_id,student_id,student_user_id,acquisition_id,status,booked_at,credits_held",
    )
    .eq("id", reservationId)
    .maybeSingle();

  if (reservationError || !reservation) {
    return { error: "reservation_not_found" as const };
  }

  const [
    { data: event, error: eventError },
    { data: student, error: studentError },
    { data: session, error: sessionError },
    { data: studio, error: studioError },
  ] = await Promise.all([
    adminClient
      .from("domain_events")
      .select("event_id,occurred_at,payload")
      .eq("studio_id", reservation.studio_id)
      .eq("event_type", "booking.created")
      .eq("source_entity_type", "reservation")
      .eq("source_entity_id", reservation.id)
      .maybeSingle(),
    adminClient
      .from("students")
      .select("id,person_id,full_name,phone,lifecycle_status,active")
      .eq("id", reservation.student_id)
      .eq("studio_id", reservation.studio_id)
      .maybeSingle(),
    adminClient
      .from("class_sessions")
      .select("id,template_id,instructor_id,space_id,starts_at,status")
      .eq("id", reservation.session_id)
      .eq("studio_id", reservation.studio_id)
      .maybeSingle(),
    adminClient
      .from("studios")
      .select("id,name,timezone")
      .eq("id", reservation.studio_id)
      .maybeSingle(),
  ]);

  if (eventError || !event) return { error: "booking_event_not_found" as const };
  if (studentError || sessionError || studioError) {
    return { error: "booking_context_failed" as const };
  }

  const { data: template, error: templateError } = session
    ? await adminClient
        .from("class_templates")
        .select("id,name,discipline_id")
        .eq("id", session.template_id)
        .eq("studio_id", reservation.studio_id)
        .maybeSingle()
    : { data: null, error: null };

  const { data: discipline, error: disciplineError } = template
    ? await adminClient
        .from("disciplines")
        .select("id,name")
        .eq("id", template.discipline_id)
        .eq("studio_id", reservation.studio_id)
        .maybeSingle()
    : { data: null, error: null };

  const [{ data: instructor }, { data: space }, { data: acquisition }] = await Promise.all([
    session?.instructor_id
      ? adminClient
          .from("instructors")
          .select("id,person_id")
          .eq("id", session.instructor_id)
          .eq("studio_id", reservation.studio_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    session?.space_id
      ? adminClient
          .from("spaces")
          .select("id,name,site_id")
          .eq("id", session.space_id)
          .eq("studio_id", reservation.studio_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    reservation.acquisition_id
      ? adminClient
          .from("product_acquisitions")
          .select("id,unlimited")
          .eq("id", reservation.acquisition_id)
          .eq("studio_id", reservation.studio_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const [{ data: instructorPerson }, { data: site }] = await Promise.all([
    instructor?.person_id
      ? adminClient
          .from("persons")
          .select("first_name,last_name")
          .eq("id", instructor.person_id)
          .eq("studio_id", reservation.studio_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    space?.site_id
      ? adminClient
          .from("sites")
          .select("name,address")
          .eq("id", space.site_id)
          .eq("studio_id", reservation.studio_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let creditsRemaining: number | null = null;
  if (reservation.acquisition_id && acquisition?.unlimited === false) {
    const { data: ledger, error: ledgerError } = await adminClient
      .from("credit_ledger")
      .select("quantity")
      .eq("acquisition_id", reservation.acquisition_id);

    if (!ledgerError) {
      creditsRemaining = (ledger ?? []).reduce(
        (total: number, movement: { quantity: number }) => total + Number(movement.quantity ?? 0),
        0,
      );
    }
  }

  const locationParts = [
    safeText(site?.name),
    safeText(space?.name),
    safeText(site?.address),
  ].filter(Boolean);

  return {
    reservation,
    event,
    student,
    session,
    studio,
    template,
    discipline,
    coach: joinName(instructorPerson?.first_name, instructorPerson?.last_name),
    location: locationParts.join(" · ") || safeText(studio?.name),
    creditsRemaining,
    contextComplete:
      !templateError &&
      !disciplineError &&
      Boolean(student && session && studio && template && discipline),
  };
}

async function recordEligibility(
  adminClient: SupabaseClient,
  input: {
    instanceId: string;
    versionNumber: number;
    reservationId: string;
    occurredAt: string;
    eventId: string;
    conditions: ReturnType<typeof buildReservationConfirmedConditions>;
    phase: "initial" | "revalidation";
  },
) {
  const { data, error } = await adminClient.rpc("record_automation_eligibility_evaluation", {
    p_instance_id: input.instanceId,
    p_version_number: input.versionNumber,
    p_candidate_key: reservationConfirmedCandidateKey(input.reservationId),
    p_candidate_occurred_at: input.occurredAt,
    p_phase: input.phase,
    p_conditions: input.conditions,
    p_event_id: input.eventId,
    p_subject_entity_type: "reservation",
    p_subject_entity_id: input.reservationId,
    p_metadata: {
      sf_ticket: "SF-175",
      trigger: "booking.created",
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

async function existingExecution(
  adminClient: SupabaseClient,
  studioId: string,
  reservationId: string,
) {
  const { data } = await adminClient
    .from("automation_executions")
    .select(
      "id,instance_id,version_number,status,origin_eligibility_evaluation_id,latest_eligibility_evaluation_id,last_error_retryable",
    )
    .eq("studio_id", studioId)
    .eq("idempotency_key", reservationConfirmedIdempotencyKey(reservationId))
    .maybeSingle();

  return (data ?? null) as ExecutionRow | null;
}

const handler = {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

    const userClient = context.supabase;
    const adminClient = context.supabaseAdmin;
    const userId = safeText(context.userClaims?.id);

    if (!userId) return jsonResponse({ error: "unauthenticated" }, 401);

    let payload: ProcessBookingCreatedRequest;
    try {
      payload = (await request.json()) as ProcessBookingCreatedRequest;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const reservationId = safeText(payload.reservationId);
    if (!reservationId || !UUID_PATTERN.test(reservationId)) {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const contextData = await loadContext(adminClient, reservationId);
    if ("error" in contextData) {
      return jsonResponse(
        { error: contextData.error },
        contextData.error === "reservation_not_found" ? 404 : 409,
      );
    }

    const authorized = await callerCanProcess(
      userClient,
      userId,
      contextData.reservation.studio_id,
      contextData.reservation.student_user_id,
    );

    if (!authorized) return jsonResponse({ error: "forbidden" }, 403);

    const conditions = buildReservationConfirmedConditions({
      reservationStatus: contextData.reservation.status,
      sessionStatus: contextData.session?.status ?? null,
      studentId: contextData.student?.id ?? null,
      recipient: contextData.student?.phone ?? null,
      contextComplete: contextData.contextComplete,
    });

    const variables = buildReservationConfirmedVariables({
      studentName: contextData.student?.full_name ?? "",
      discipline: contextData.discipline?.name ?? contextData.template?.name ?? "",
      startsAt: contextData.session?.starts_at ?? contextData.event.occurred_at,
      timeZone: contextData.studio?.timezone ?? "UTC",
      coach: contextData.coach,
      location: contextData.location,
      creditsRemaining: contextData.creditsRemaining,
    });

    let execution = await existingExecution(
      adminClient,
      contextData.reservation.studio_id,
      reservationId,
    );

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
        if (!(await claimEvent(adminClient, contextData.event.event_id))) {
          return jsonResponse({ error: "domain_event_claim_failed" }, 500);
        }
        return jsonResponse({
          ok: true,
          outcome: "accepted",
          executionId: execution.id,
          reused: true,
        });
      }

      if (execution.status === "suppressed" || execution.status === "cancelled") {
        if (!(await claimEvent(adminClient, contextData.event.event_id))) {
          return jsonResponse({ error: "domain_event_claim_failed" }, 500);
        }
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
          if (!(await claimEvent(adminClient, contextData.event.event_id))) {
            return jsonResponse({ error: "domain_event_claim_failed" }, 500);
          }
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
          reservationId,
          occurredAt: contextData.event.occurred_at,
          eventId: contextData.event.event_id,
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

          if (!(await claimEvent(adminClient, contextData.event.event_id))) {
            return jsonResponse({ error: "domain_event_claim_failed" }, 500);
          }
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
        .eq("studio_id", contextData.reservation.studio_id)
        .eq("catalog_code", RESERVATION_CONFIRMED_CATALOG_CODE)
        .eq("status", "active")
        .limit(2);

      if (instanceError) return jsonResponse({ error: "automation_instance_lookup_failed" }, 500);

      if (!activeInstances?.length) {
        if (!(await claimEvent(adminClient, contextData.event.event_id))) {
          return jsonResponse({ error: "domain_event_claim_failed" }, 500);
        }
        return jsonResponse({
          ok: true,
          outcome: "inactive",
          eventId: contextData.event.event_id,
        });
      }

      if (activeInstances.length > 1) {
        return jsonResponse({ error: "automation_instance_conflict" }, 409);
      }

      instance = activeInstances[0] as InstanceRow;

      const initial = await recordEligibility(adminClient, {
        instanceId: instance.id,
        versionNumber: instance.current_version_number,
        reservationId,
        occurredAt: contextData.event.occurred_at,
        eventId: contextData.event.event_id,
        conditions,
        phase: "initial",
      });

      if (!initial) return jsonResponse({ error: "eligibility_failed" }, 500);

      if (!initial.eligible || initial.outcome !== "proceed") {
        if (!(await claimEvent(adminClient, contextData.event.event_id))) {
          return jsonResponse({ error: "domain_event_claim_failed" }, 500);
        }
        return jsonResponse({
          ok: true,
          outcome: "skipped",
          eventId: contextData.event.event_id,
          exclusionReasons: initial.exclusion_reasons,
        });
      }

      eligibilityEvaluationId = initial.evaluation_id;

      const { data: executionResult, error: executionError } = await adminClient.rpc(
        "system_create_automation_execution",
        {
          p_eligibility_evaluation_id: initial.evaluation_id,
          p_idempotency_key: reservationConfirmedIdempotencyKey(reservationId),
          p_data_snapshot: {
            reservation_id: reservationId,
            session_id: contextData.reservation.session_id,
            student_id: contextData.reservation.student_id,
            acquisition_id: contextData.reservation.acquisition_id,
            event_id: contextData.event.event_id,
          },
          p_template_snapshot: {
            catalog_code: RESERVATION_CONFIRMED_CATALOG_CODE,
            template: RESERVATION_CONFIRMED_TEMPLATE,
          },
          p_variables_snapshot: variables,
          p_scheduled_for: null,
        },
      );

      if (executionError || !executionResult) {
        execution = await existingExecution(
          adminClient,
          contextData.reservation.studio_id,
          reservationId,
        );

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

    if (!execution || !eligibilityEvaluationId || !instance) {
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
      const concurrent = await existingExecution(
        adminClient,
        contextData.reservation.studio_id,
        reservationId,
      );

      if (concurrent?.status === "accepted") {
        if (!(await claimEvent(adminClient, contextData.event.event_id))) {
          return jsonResponse({ error: "domain_event_claim_failed" }, 500);
        }
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
      template: RESERVATION_CONFIRMED_TEMPLATE,
      variables,
      executionId: execution.id,
      metadata: {
        catalog_code: RESERVATION_CONFIRMED_CATALOG_CODE,
        event_id: contextData.event.event_id,
        reservation_id: reservationId,
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
      const { error: sentError } = await adminClient.rpc(
        "system_mark_automation_execution_sent",
        {
          p_attempt_id: attempt.attempt_id,
          p_provider_key: provider.key,
          p_request_snapshot: requestSnapshot(providerInput),
        },
      );

      if (sentError) {
        const refreshed = await existingExecution(
          adminClient,
          contextData.reservation.studio_id,
          reservationId,
        );

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

      const beforeAccept = await existingExecution(
        adminClient,
        contextData.reservation.studio_id,
        reservationId,
      );

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
          const refreshed = await existingExecution(
            adminClient,
            contextData.reservation.studio_id,
            reservationId,
          );

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

      if (!(await claimEvent(adminClient, contextData.event.event_id))) {
        return jsonResponse({ error: "domain_event_claim_failed" }, 500);
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
      if (!(await claimEvent(adminClient, contextData.event.event_id))) {
        return jsonResponse({ error: "domain_event_claim_failed" }, 500);
      }
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
