import { getAutomationTemplate, type AutomationCatalogCode } from "./catalog";

export type AutomationInstanceStatus = "draft" | "active" | "paused" | "error" | "archived";

export type AutomationConfiguration = Record<string, unknown>;

export interface AutomationInstanceRpcError {
  message: string;
}

export interface AutomationInstanceRpcResult<T> {
  data: T | null;
  error: AutomationInstanceRpcError | null;
}

export interface AutomationInstanceRpcClient {
  rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<AutomationInstanceRpcResult<T>>;
}

function assertConfigurationObject(configuration: AutomationConfiguration): void {
  if (typeof configuration !== "object" || configuration === null || Array.isArray(configuration)) {
    throw new Error("automation_configuration_must_be_object");
  }
}

export function assertAutomationConfiguration(
  catalogCode: AutomationCatalogCode,
  configuration: AutomationConfiguration,
): void {
  assertConfigurationObject(configuration);

  const template = getAutomationTemplate(catalogCode);
  const allowed = new Set(template.configurableParameters);

  for (const key of Object.keys(configuration)) {
    if (!allowed.has(key)) {
      throw new Error(`automation_configuration_key_not_allowed:${key}`);
    }
  }
}

function assertAdminManageable(catalogCode: AutomationCatalogCode): void {
  const template = getAutomationTemplate(catalogCode);

  if (template.configurationMode === "system_managed") {
    throw new Error("automation_instance_system_managed");
  }
}

async function unwrapRpc<T>(resultPromise: Promise<AutomationInstanceRpcResult<T>>): Promise<T> {
  const result = await resultPromise;

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.data === null) {
    throw new Error("automation_instance_rpc_empty_result");
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

export async function createAutomationInstance(
  client: AutomationInstanceRpcClient,
  input: {
    studioId: string;
    catalogCode: AutomationCatalogCode;
    configuration?: AutomationConfiguration;
  },
): Promise<string> {
  const configuration = input.configuration ?? {};

  assertAdminManageable(input.catalogCode);
  assertAutomationConfiguration(input.catalogCode, configuration);

  return unwrapRpc(
    client.rpc<string>("admin_create_automation_instance", {
      p_studio_id: input.studioId,
      p_catalog_code: input.catalogCode,
      p_configuration: configuration,
    }),
  );
}

export async function updateAutomationInstanceConfiguration(
  client: AutomationInstanceRpcClient,
  input: {
    instanceId: string;
    catalogCode: AutomationCatalogCode;
    configuration: AutomationConfiguration;
  },
): Promise<number> {
  assertAdminManageable(input.catalogCode);
  assertAutomationConfiguration(input.catalogCode, input.configuration);

  return unwrapRpc(
    client.rpc<number>("admin_update_automation_instance_configuration", {
      p_instance_id: input.instanceId,
      p_configuration: input.configuration,
    }),
  );
}

export async function activateAutomationInstance(
  client: AutomationInstanceRpcClient,
  instanceId: string,
): Promise<void> {
  return unwrapVoidRpc(
    client.rpc("admin_activate_automation_instance", {
      p_instance_id: instanceId,
    }),
  );
}

export async function pauseAutomationInstance(
  client: AutomationInstanceRpcClient,
  instanceId: string,
): Promise<void> {
  return unwrapVoidRpc(
    client.rpc("admin_pause_automation_instance", {
      p_instance_id: instanceId,
    }),
  );
}

export async function archiveAutomationInstance(
  client: AutomationInstanceRpcClient,
  instanceId: string,
): Promise<void> {
  return unwrapVoidRpc(
    client.rpc("admin_archive_automation_instance", {
      p_instance_id: instanceId,
    }),
  );
}

export async function deleteAutomationDraft(
  client: AutomationInstanceRpcClient,
  instanceId: string,
): Promise<void> {
  return unwrapVoidRpc(
    client.rpc("admin_delete_automation_draft", {
      p_instance_id: instanceId,
    }),
  );
}

export async function systemCreateAutomationInstance(
  client: AutomationInstanceRpcClient,
  input: {
    studioId: string;
    catalogCode: AutomationCatalogCode;
    configuration?: AutomationConfiguration;
  },
): Promise<string> {
  const configuration = input.configuration ?? {};

  assertAutomationConfiguration(input.catalogCode, configuration);

  return unwrapRpc(
    client.rpc<string>("system_create_automation_instance", {
      p_studio_id: input.studioId,
      p_catalog_code: input.catalogCode,
      p_configuration: configuration,
    }),
  );
}

export async function setAutomationInstanceError(
  client: AutomationInstanceRpcClient,
  input: {
    instanceId: string;
    errorCode: string;
    errorMessage: string;
  },
): Promise<void> {
  if (!input.errorCode.trim() || !input.errorMessage.trim()) {
    throw new Error("automation_instance_error_details_required");
  }

  return unwrapVoidRpc(
    client.rpc("system_set_automation_instance_error", {
      p_instance_id: input.instanceId,
      p_error_code: input.errorCode.trim(),
      p_error_message: input.errorMessage.trim(),
    }),
  );
}

export async function markAutomationInstanceExecuted(
  client: AutomationInstanceRpcClient,
  input: {
    instanceId: string;
    versionNumber: number;
    executedAt?: string;
  },
): Promise<void> {
  return unwrapVoidRpc(
    client.rpc("system_mark_automation_instance_executed", {
      p_instance_id: input.instanceId,
      p_version_number: input.versionNumber,
      ...(input.executedAt ? { p_executed_at: input.executedAt } : {}),
    }),
  );
}
