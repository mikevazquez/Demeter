import {
  markAutomationExecutionAccepted,
  markAutomationExecutionError,
  markAutomationExecutionSent,
  startAutomationExecutionAttempt,
} from "./executions";
import type { AutomationInstanceRpcClient } from "./instances";

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
  MessagingProviderAcceptedResult | MessagingProviderErrorResult;

export interface MessagingProvider {
  readonly key: string;
  send(input: MessagingProviderInput): Promise<MessagingProviderResult>;
}

export type MessagingDeliveryResult =
  | (MessagingProviderAcceptedResult & {
      attemptId: string;
      attemptNumber: number;
      providerKey: string;
    })
  | (MessagingProviderErrorResult & {
      attemptId: string;
      attemptNumber: number;
      providerKey: string;
    });

export interface DeliverAutomationMessageInput {
  executionId: string;
  eligibilityEvaluationId: string;
  recipient: string;
  template: string;
  variables?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function assertRecord(value: unknown, code: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(code);
  }
}

function requiredText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function optionalSnapshot(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  assertRecord(value, "messaging_provider_response_snapshot_must_be_object");
  return value;
}

function normalizeProviderResult(value: MessagingProviderResult): MessagingProviderResult {
  if (!value || typeof value !== "object") {
    return {
      status: "error",
      errorCode: "provider_contract_error",
      errorMessage: "El proveedor devolvió una respuesta inválida.",
      retryable: false,
    };
  }

  if (value.status === "accepted") {
    return {
      status: "accepted",
      providerReference: value.providerReference?.trim() || undefined,
      responseSnapshot: optionalSnapshot(value.responseSnapshot),
    };
  }

  if (value.status === "error") {
    const errorCode = value.errorCode?.trim();
    const errorMessage = value.errorMessage?.trim();

    if (!errorCode || !errorMessage || typeof value.retryable !== "boolean") {
      return {
        status: "error",
        errorCode: "provider_contract_error",
        errorMessage: "El proveedor devolvió un error sin el contrato requerido.",
        retryable: false,
      };
    }

    return {
      status: "error",
      errorCode,
      errorMessage,
      retryable: value.retryable,
      responseSnapshot: optionalSnapshot(value.responseSnapshot),
    };
  }

  return {
    status: "error",
    errorCode: "provider_contract_error",
    errorMessage: "El proveedor devolvió un estado desconocido.",
    retryable: false,
  };
}

function providerExceptionResult(error: unknown): MessagingProviderErrorResult {
  return {
    status: "error",
    errorCode: "provider_exception",
    errorMessage: error instanceof Error ? error.message : "Excepción desconocida del proveedor.",
    retryable: true,
  };
}

function buildProviderInput(input: DeliverAutomationMessageInput): MessagingProviderInput {
  const variables = input.variables ?? {};
  const metadata = input.metadata ?? {};

  assertRecord(variables, "messaging_provider_variables_must_be_object");
  assertRecord(metadata, "messaging_provider_metadata_must_be_object");

  return {
    recipient: requiredText(input.recipient, "messaging_provider_recipient_required"),
    template: requiredText(input.template, "messaging_provider_template_required"),
    variables,
    executionId: requiredText(input.executionId, "messaging_provider_execution_id_required"),
    metadata,
  };
}

function sensitiveVariableKeys(metadata: Record<string, unknown>): Set<string> {
  const configured = metadata.sensitive_variable_keys;
  if (!Array.isArray(configured)) return new Set();

  return new Set(
    configured
      .filter((key): key is string => typeof key === "string" && key.trim().length > 0)
      .map((key) => key.trim()),
  );
}

function snapshotVariables(input: MessagingProviderInput): Record<string, unknown> {
  const sensitiveKeys = sensitiveVariableKeys(input.metadata);
  if (!sensitiveKeys.size) return input.variables;

  return Object.fromEntries(
    Object.entries(input.variables).map(([key, value]) => [
      key,
      sensitiveKeys.has(key) ? "[REDACTED]" : value,
    ]),
  );
}

function requestSnapshot(input: MessagingProviderInput): Record<string, unknown> {
  return {
    recipient: input.recipient,
    template: input.template,
    variables: snapshotVariables(input),
    execution_id: input.executionId,
    metadata: input.metadata,
  };
}

export async function deliverAutomationMessage(
  client: AutomationInstanceRpcClient,
  provider: MessagingProvider,
  input: DeliverAutomationMessageInput,
): Promise<MessagingDeliveryResult> {
  const providerKey = requiredText(provider.key, "messaging_provider_key_required");
  const providerInput = buildProviderInput(input);
  const eligibilityEvaluationId = requiredText(
    input.eligibilityEvaluationId,
    "messaging_provider_eligibility_evaluation_id_required",
  );

  const attempt = await startAutomationExecutionAttempt(client, {
    executionId: providerInput.executionId,
    eligibilityEvaluationId,
  });

  let result: MessagingProviderResult;

  try {
    result = normalizeProviderResult(await provider.send(providerInput));
  } catch (error) {
    result = providerExceptionResult(error);
  }

  await markAutomationExecutionSent(client, {
    attemptId: attempt.attemptId,
    providerKey,
    requestSnapshot: requestSnapshot(providerInput),
  });

  if (result.status === "accepted") {
    await markAutomationExecutionAccepted(client, {
      attemptId: attempt.attemptId,
      providerReference: result.providerReference,
      responseSnapshot: result.responseSnapshot ?? {},
    });

    return {
      ...result,
      attemptId: attempt.attemptId,
      attemptNumber: attempt.attemptNumber,
      providerKey,
    };
  }

  await markAutomationExecutionError(client, {
    attemptId: attempt.attemptId,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    retryable: result.retryable,
  });

  return {
    ...result,
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    providerKey,
  };
}

export type MockMessagingProviderResolver = (
  input: MessagingProviderInput,
  deliveryNumber: number,
) => MessagingProviderResult | Promise<MessagingProviderResult>;

export interface MockMessagingDelivery {
  deliveryNumber: number;
  input: MessagingProviderInput;
}

export class MockMessagingProvider implements MessagingProvider {
  readonly key = "mock";

  private readonly recordedDeliveries: MockMessagingDelivery[] = [];

  constructor(private readonly resolver?: MockMessagingProviderResolver) {}

  get deliveries(): readonly MockMessagingDelivery[] {
    return this.recordedDeliveries;
  }

  async send(input: MessagingProviderInput): Promise<MessagingProviderResult> {
    const deliveryNumber = this.recordedDeliveries.length + 1;
    const recordedInput: MessagingProviderInput = {
      ...input,
      variables: { ...input.variables },
      metadata: { ...input.metadata },
    };

    this.recordedDeliveries.push({
      deliveryNumber,
      input: recordedInput,
    });

    if (this.resolver) {
      return this.resolver(recordedInput, deliveryNumber);
    }

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
