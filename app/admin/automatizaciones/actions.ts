"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import {
  getAutomationTemplate,
  type AutomationCatalogCode,
} from "@/lib/automations/catalog";

const numericConfigurationKeys = new Set([
  "days_before_expiration",
  "inactivity_days",
  "elapsed_since_expiration",
]);

function asCatalogCode(value: FormDataEntryValue | null): AutomationCatalogCode | null {
  const code = String(value ?? "").trim() as AutomationCatalogCode;
  try {
    getAutomationTemplate(code);
    return code;
  } catch {
    return null;
  }
}

function detailUrl(code: string, params: Record<string, string>) {
  const search = new URLSearchParams(params);
  return `/admin/automatizaciones/${encodeURIComponent(code)}?${search.toString()}`;
}

function parseConfiguration(code: AutomationCatalogCode, formData: FormData) {
  const template = getAutomationTemplate(code);
  const configuration: Record<string, unknown> = {};

  for (const key of template.configurableParameters) {
    const raw = String(formData.get(`config_${key}`) ?? "").trim();
    if (!raw) continue;

    if (numericConfigurationKeys.has(key)) {
      const number = Number(raw);
      if (!Number.isInteger(number) || number < 0) {
        throw new Error(`invalid_number:${key}`);
      }
      configuration[key] = number;
      continue;
    }

    if (key === "optional_filters") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("optional_filters_must_be_object");
        }
        configuration[key] = parsed;
      } catch {
        throw new Error("optional_filters_invalid_json");
      }
      continue;
    }

    configuration[key] = raw;
  }

  return configuration;
}

function revalidateAutomationPaths(code: string) {
  revalidatePath("/admin/empresa");
  revalidatePath("/admin/automatizaciones");
  revalidatePath(`/admin/automatizaciones/${code}`);
}

export async function createAutomationAction(formData: FormData) {
  const code = asCatalogCode(formData.get("catalog_code"));
  if (!code) redirect("/admin/automatizaciones?error=catalog_invalid");

  let configuration: Record<string, unknown>;
  try {
    configuration = parseConfiguration(code, formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "configuration_invalid";
    redirect(detailUrl(code, { error: message }));
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const { data, error } = await supabase.rpc("admin_create_automation_instance", {
    p_studio_id: studio.id,
    p_catalog_code: code,
    p_configuration: configuration,
  });

  if (error || !data) {
    redirect(detailUrl(code, { error: error?.message ?? "create_failed" }));
  }

  revalidateAutomationPaths(code);
  redirect(detailUrl(code, { saved: "created", instance: String(data) }));
}

export async function updateAutomationConfigurationAction(formData: FormData) {
  const code = asCatalogCode(formData.get("catalog_code"));
  const instanceId = String(formData.get("instance_id") ?? "").trim();
  if (!code || !instanceId) redirect("/admin/automatizaciones?error=instance_invalid");

  let configuration: Record<string, unknown>;
  try {
    configuration = parseConfiguration(code, formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "configuration_invalid";
    redirect(detailUrl(code, { error: message, instance: instanceId }));
  }

  const { supabase } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const { data, error } = await supabase.rpc("admin_update_automation_instance_configuration", {
    p_instance_id: instanceId,
    p_configuration: configuration,
  });

  if (error || data == null) {
    redirect(
      detailUrl(code, {
        error: error?.message ?? "update_failed",
        instance: instanceId,
      }),
    );
  }

  revalidateAutomationPaths(code);
  redirect(
    detailUrl(code, {
      saved: "configuration",
      instance: instanceId,
      version: String(data),
    }),
  );
}

async function transitionAutomation(
  formData: FormData,
  rpcName:
    | "admin_activate_automation_instance"
    | "admin_pause_automation_instance"
    | "admin_archive_automation_instance"
    | "admin_delete_automation_draft",
  saved: string,
) {
  const code = asCatalogCode(formData.get("catalog_code"));
  const instanceId = String(formData.get("instance_id") ?? "").trim();
  if (!code || !instanceId) redirect("/admin/automatizaciones?error=instance_invalid");

  const { supabase } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const { error } = await supabase.rpc(rpcName, { p_instance_id: instanceId });

  if (error) {
    redirect(detailUrl(code, { error: error.message, instance: instanceId }));
  }

  revalidateAutomationPaths(code);
  redirect(detailUrl(code, { saved, instance: instanceId }));
}

export async function activateAutomationAction(formData: FormData) {
  return transitionAutomation(
    formData,
    "admin_activate_automation_instance",
    "activated",
  );
}

export async function pauseAutomationAction(formData: FormData) {
  return transitionAutomation(formData, "admin_pause_automation_instance", "paused");
}

export async function archiveAutomationAction(formData: FormData) {
  return transitionAutomation(
    formData,
    "admin_archive_automation_instance",
    "archived",
  );
}

export async function deleteAutomationDraftAction(formData: FormData) {
  return transitionAutomation(
    formData,
    "admin_delete_automation_draft",
    "deleted",
  );
}
