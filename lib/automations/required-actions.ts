export type RequiredActionPriority = "high" | "medium" | "low";
export type RequiredActionStatus = "pending" | "in_progress" | "resolved" | "discarded";

export interface RequiredActionRpcError {
  message: string;
  code?: string;
}

export interface RequiredActionRpcResult<T> {
  data: T | null;
  error: RequiredActionRpcError | null;
}

export interface RequiredActionRpcClient {
  rpc<T>(functionName: string, args: Record<string, unknown>): Promise<RequiredActionRpcResult<T>>;
}

export interface CreateRequiredActionInput {
  studioId: string;
  incidentKey: string;
  priority: RequiredActionPriority;
  sourceEventId: string;
  reason: string;
  studentId?: string | null;
  classSessionId?: string | null;
  assigneeUserId?: string | null;
}

function requiredText(value: string, code: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

async function rpcValue<T>(
  client: RequiredActionRpcClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.rpc<T>(functionName, args);
  if (result.error) {
    throw new Error(`required_action_rpc_failed:${functionName}:${result.error.message}`);
  }
  if (result.data === null) {
    throw new Error(`required_action_rpc_missing_result:${functionName}`);
  }
  return result.data;
}

async function rpcVoid(
  client: RequiredActionRpcClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<void> {
  const result = await client.rpc<null>(functionName, args);
  if (result.error) {
    throw new Error(`required_action_rpc_failed:${functionName}:${result.error.message}`);
  }
}

function createArgs(input: CreateRequiredActionInput): Record<string, unknown> {
  return {
    p_studio_id: requiredText(input.studioId, "required_action_studio_required"),
    p_incident_key: requiredText(input.incidentKey, "required_action_incident_key_required"),
    p_priority: input.priority,
    p_source_event_id: requiredText(input.sourceEventId, "required_action_source_event_required"),
    p_reason: requiredText(input.reason, "required_action_reason_required"),
    p_student_id: input.studentId ?? null,
    p_class_session_id: input.classSessionId ?? null,
    p_assignee_user_id: input.assigneeUserId ?? null,
  };
}

export async function createRequiredAction(
  client: RequiredActionRpcClient,
  input: CreateRequiredActionInput,
): Promise<string> {
  return rpcValue<string>(client, "admin_create_required_action", createArgs(input));
}

export async function systemCreateRequiredAction(
  client: RequiredActionRpcClient,
  input: CreateRequiredActionInput,
): Promise<string> {
  return rpcValue<string>(client, "system_create_required_action", createArgs(input));
}

export async function assignRequiredAction(
  client: RequiredActionRpcClient,
  actionId: string,
  assigneeUserId: string,
): Promise<void> {
  await rpcVoid(client, "admin_assign_required_action", {
    p_action_id: requiredText(actionId, "required_action_id_required"),
    p_assignee_user_id: requiredText(assigneeUserId, "required_action_assignee_required"),
  });
}

export async function takeRequiredAction(
  client: RequiredActionRpcClient,
  actionId: string,
): Promise<void> {
  await rpcVoid(client, "admin_take_required_action", {
    p_action_id: requiredText(actionId, "required_action_id_required"),
  });
}

export async function resolveRequiredAction(
  client: RequiredActionRpcClient,
  actionId: string,
  result?: string | null,
): Promise<void> {
  await rpcVoid(client, "admin_resolve_required_action", {
    p_action_id: requiredText(actionId, "required_action_id_required"),
    p_result: result?.trim() || null,
  });
}

export async function discardRequiredAction(
  client: RequiredActionRpcClient,
  actionId: string,
  reason: string,
): Promise<void> {
  await rpcVoid(client, "admin_discard_required_action", {
    p_action_id: requiredText(actionId, "required_action_id_required"),
    p_reason: requiredText(reason, "required_action_discard_reason_required"),
  });
}

export async function systemAutoCloseRequiredAction(
  client: RequiredActionRpcClient,
  studioId: string,
  incidentKey: string,
  result?: string | null,
): Promise<string | null> {
  const response = await client.rpc<string>("system_auto_close_required_action", {
    p_studio_id: requiredText(studioId, "required_action_studio_required"),
    p_incident_key: requiredText(incidentKey, "required_action_incident_key_required"),
    p_result: result?.trim() || null,
  });

  if (response.error) {
    throw new Error(
      `required_action_rpc_failed:system_auto_close_required_action:${response.error.message}`,
    );
  }

  return response.data;
}
