export type DomainEventPayload = Readonly<Record<string, unknown>>;

export interface DomainEventRpcError {
  message: string;
  code?: string;
}

export interface DomainEventRpcResult<T> {
  data: T | null;
  error: DomainEventRpcError | null;
}

export interface DomainEventRpcClient {
  rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<DomainEventRpcResult<T>>;
}

export interface EmitDomainEventInput {
  studioId: string;
  eventType: string;
  sourceEntityType: string;
  sourceEntityId: string;
  deduplicationKey: string;
  occurredAt?: string;
  actorUserId?: string | null;
  payload?: DomainEventPayload;
  correlationId?: string | null;
  causationEventId?: string | null;
  eventId?: string;
}

function requiredText(value: string, code: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

export async function emitDomainEvent(
  client: DomainEventRpcClient,
  input: EmitDomainEventInput,
): Promise<string> {
  const args: Record<string, unknown> = {
    p_studio_id: requiredText(input.studioId, "domain_event_studio_required"),
    p_event_type: requiredText(input.eventType, "domain_event_type_required"),
    p_source_entity_type: requiredText(
      input.sourceEntityType,
      "domain_event_source_required",
    ),
    p_source_entity_id: requiredText(
      input.sourceEntityId,
      "domain_event_source_required",
    ),
    p_deduplication_key: requiredText(
      input.deduplicationKey,
      "domain_event_deduplication_key_required",
    ),
    p_payload: input.payload ?? {},
  };

  if (input.occurredAt) args.p_occurred_at = input.occurredAt;
  if (input.actorUserId !== undefined) args.p_actor_user_id = input.actorUserId;
  if (input.correlationId !== undefined) args.p_correlation_id = input.correlationId;
  if (input.causationEventId !== undefined) {
    args.p_causation_event_id = input.causationEventId;
  }
  if (input.eventId) args.p_event_id = input.eventId;

  const result = await client.rpc<string>("emit_domain_event", args);

  if (result.error) {
    throw new Error(`domain_event_emit_failed:${result.error.message}`);
  }
  if (!result.data) {
    throw new Error("domain_event_emit_missing_id");
  }

  return result.data;
}

export async function claimDomainEvent(
  client: DomainEventRpcClient,
  eventId: string,
  consumerKey: string,
): Promise<boolean> {
  const result = await client.rpc<boolean>("claim_domain_event", {
    p_event_id: requiredText(eventId, "domain_event_id_required"),
    p_consumer_key: requiredText(
      consumerKey,
      "domain_event_consumer_required",
    ),
  });

  if (result.error) {
    throw new Error(`domain_event_claim_failed:${result.error.message}`);
  }
  if (result.data === null) {
    throw new Error("domain_event_claim_missing_result");
  }

  return result.data;
}
