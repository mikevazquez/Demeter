import type { AutomationInstanceRpcClient, AutomationInstanceRpcResult } from "./instances";

export type AutomationExecutionStatus =
  | "eligible"
  | "scheduled"
  | "processing"
  | "sent"
  | "accepted"
  | "suppressed"
  | "cancelled"
  | "error";

export interface AutomationExecutionCreateResult {
  executionId: string;
  status: AutomationExecutionStatus;
  created: boolean;
}

export interface AutomationExecutionAttemptResult {
  attemptId: string;
  attemptNumber: number;
}

async function unwrapRpc<T>(resultPromise: Promise<AutomationInstanceRpcResult<T>>): Promise<T> {
  const result = await resultPromise;

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.data === null) {
    throw new Error("automation_execution_rpc_empty_result");
  }

  return result.data;
}

async function unwrapVoidRpc(
  resultPromise: Promise<AutomationInstanceRpcResult<unknown>>,
): Promise<void> {
  const result = await resultPromise;

  if (result.error) {
    throw new Error(result.error.message);
  }
}

function assertObject(value: Record<string, unknown>, code: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(code);
  }
}

export async function createAutomationExecution(
  client: AutomationInstanceRpcClient,
  input: {
    eligibilityEvaluationId: string;
    idempotencyKey: string;
    dataSnapshot?: Record<string, unknown>;
    templateSnapshot?: Record<string, unknown>;
    variablesSnapshot?: Record<string, unknown>;
    scheduledFor?: string;
  },
): Promise<AutomationExecutionCreateResult> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("automation_execution_idempotency_key_required");
  }

  const dataSnapshot = input.dataSnapshot ?? {};
  const templateSnapshot = input.templateSnapshot ?? {};
  const variablesSnapshot = input.variablesSnapshot ?? {};

  assertObject(dataSnapshot, "automation_execution_data_snapshot_must_be_object");
  assertObject(templateSnapshot, "automation_execution_template_snapshot_must_be_object");
  assertObject(variablesSnapshot, "automation_execution_variables_snapshot_must_be_object");

  const data = await unwrapRpc(
    client.rpc<{
      execution_id: string;
      status: AutomationExecutionStatus;
      created: boolean;
    }>("system_create_automation_execution", {
      p_eligibility_evaluation_id: input.eligibilityEvaluationId,
      p_idempotency_key: input.idempotencyKey.trim(),
      p_data_snapshot: dataSnapshot,
      p_template_snapshot: templateSnapshot,
      p_variables_snapshot: variablesSnapshot,
      p_scheduled_for: input.scheduledFor ?? null,
    }),
  );

  return {
    executionId: data.execution_id,
    status: data.status,
    created: data.created,
  };
}

export async function startAutomationExecutionAttempt(
  client: AutomationInstanceRpcClient,
  input: {
    executionId: string;
    eligibilityEvaluationId: string;
  },
): Promise<AutomationExecutionAttemptResult> {
  const data = await unwrapRpc(
    client.rpc<{
      attempt_id: string;
      attempt_number: number;
    }>("system_start_automation_execution_attempt", {
      p_execution_id: input.executionId,
      p_eligibility_evaluation_id: input.eligibilityEvaluationId,
    }),
  );

  return {
    attemptId: data.attempt_id,
    attemptNumber: data.attempt_number,
  };
}

export async function markAutomationExecutionSent(
  client: AutomationInstanceRpcClient,
  input: {
    attemptId: string;
    providerKey: string;
    requestSnapshot?: Record<string, unknown>;
  },
): Promise<void> {
  if (!input.providerKey.trim()) {
    throw new Error("automation_execution_provider_key_required");
  }

  return unwrapVoidRpc(
    client.rpc("system_mark_automation_execution_sent", {
      p_attempt_id: input.attemptId,
      p_provider_key: input.providerKey.trim(),
      p_request_snapshot: input.requestSnapshot ?? {},
    }),
  );
}

export async function markAutomationExecutionAccepted(
  client: AutomationInstanceRpcClient,
  input: {
    attemptId: string;
    providerReference?: string;
    responseSnapshot?: Record<string, unknown>;
  },
): Promise<void> {
  return unwrapVoidRpc(
    client.rpc("system_mark_automation_execution_accepted", {
      p_attempt_id: input.attemptId,
      p_provider_reference: input.providerReference?.trim() || null,
      p_response_snapshot: input.responseSnapshot ?? {},
    }),
  );
}

export async function markAutomationExecutionError(
  client: AutomationInstanceRpcClient,
  input: {
    attemptId: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  },
): Promise<void> {
  if (!input.errorCode.trim() || !input.errorMessage.trim()) {
    throw new Error("automation_execution_error_details_required");
  }

  return unwrapVoidRpc(
    client.rpc("system_mark_automation_execution_error", {
      p_attempt_id: input.attemptId,
      p_error_code: input.errorCode.trim(),
      p_error_message: input.errorMessage.trim(),
      p_retryable: input.retryable,
    }),
  );
}

export async function suppressAutomationExecution(
  client: AutomationInstanceRpcClient,
  input: {
    executionId: string;
    reasonCode: string;
    reason: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  if (!input.reasonCode.trim() || !input.reason.trim()) {
    throw new Error("automation_execution_suppression_reason_required");
  }

  return unwrapVoidRpc(
    client.rpc("system_suppress_automation_execution", {
      p_execution_id: input.executionId,
      p_reason_code: input.reasonCode.trim(),
      p_reason: input.reason.trim(),
      p_details: input.details ?? {},
    }),
  );
}

export async function cancelAutomationExecution(
  client: AutomationInstanceRpcClient,
  input: {
    executionId: string;
    revalidationEvaluationId: string;
  },
): Promise<void> {
  return unwrapVoidRpc(
    client.rpc("system_cancel_automation_execution", {
      p_execution_id: input.executionId,
      p_revalidation_evaluation_id: input.revalidationEvaluationId,
    }),
  );
}
