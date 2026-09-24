"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import {
  getAutomationTemplate,
  type AutomationCatalogCode,
} from "@/lib/automations/catalog";
import {
  getMarketingCommunication,
  getNotificationProcess,
  type NotificationChannelKey,
} from "@/lib/notifications/admin-catalog";

function processUrl(processKey: string, params: Record<string, string> = {}) {
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return `/admin/notificaciones/${encodeURIComponent(processKey)}${suffix}`;
}

function listUrl(tab: string, params: Record<string, string> = {}) {
  const search = new URLSearchParams({ tab, ...params });
  return `/admin/notificaciones?${search.toString()}`;
}

function requiredProcess(formData: FormData) {
  const key = String(formData.get("process_key") ?? "").trim();
  const process = getNotificationProcess(key);
  if (!process || process.planned || process.ruleKeys.length === 0) {
    throw new Error("notification_process_unavailable");
  }
  return process;
}

function parseChannel(value: FormDataEntryValue | null): NotificationChannelKey {
  const channel = String(value ?? "").trim();
  if (channel === "push" || channel === "whatsapp" || channel === "email") return channel;
  throw new Error("notification_channel_invalid");
}

function refresh(processKey?: string) {
  revalidatePath("/admin/notificaciones");
  if (processKey) revalidatePath(`/admin/notificaciones/${processKey}`);
}

export async function toggleNotificationProcessAction(formData: FormData) {
  let process;
  try {
    process = requiredProcess(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "notification_process_unavailable";
    redirect(listUrl("procesos", { error: message }));
  }

  const enabled = String(formData.get("next_enabled") ?? "") === "true";
  const { supabase, studio } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);

  const { error } = await supabase.rpc("admin_set_notification_rules_enabled", {
    p_studio_id: studio.id,
    p_rule_keys: [...process.ruleKeys],
    p_enabled: enabled,
  });

  if (error) {
    redirect(processUrl(process.key, { error: error.message }));
  }

  refresh(process.key);
  redirect(processUrl(process.key, { saved: enabled ? "activated" : "paused" }));
}

export async function toggleNotificationChannelAction(formData: FormData) {
  let process;
  let channel: NotificationChannelKey;
  try {
    process = requiredProcess(formData);
    channel = parseChannel(formData.get("channel"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "notification_channel_invalid";
    redirect(listUrl("procesos", { error: message }));
  }

  const enabled = String(formData.get("next_enabled") ?? "") === "true";
  const { supabase, studio } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);

  const { error } = await supabase.rpc("admin_set_notification_rules_channel", {
    p_studio_id: studio.id,
    p_rule_keys: [...process.ruleKeys],
    p_channel_key: channel,
    p_enabled: enabled,
  });

  if (error) {
    redirect(processUrl(process.key, { error: error.message }));
  }

  refresh(process.key);
  redirect(
    processUrl(process.key, {
      saved: enabled ? `${channel}_enabled` : `${channel}_disabled`,
    }),
  );
}

export async function saveNotificationMessageAction(formData: FormData) {
  let process;
  let channel: NotificationChannelKey;
  try {
    process = requiredProcess(formData);
    channel = parseChannel(formData.get("channel"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "notification_message_invalid";
    redirect(listUrl("plantillas", { error: message }));
  }

  if (channel === "whatsapp") {
    redirect(processUrl(process.key, { error: "notification_whatsapp_provider_managed" }));
  }

  const title = String(formData.get("title_template") ?? "").trim();
  const body = String(formData.get("body_template") ?? "").trim();
  const reset = String(formData.get("reset") ?? "") === "true";

  if (!reset && (!title || !body)) {
    redirect(processUrl(process.key, { error: "notification_message_title_body_required" }));
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const { error } = await supabase.rpc("admin_update_notification_rules_message", {
    p_studio_id: studio.id,
    p_rule_keys: [...process.ruleKeys],
    p_channel_key: channel,
    p_title_template: title || null,
    p_body_template: body || null,
    p_reset: reset,
  });

  if (error) {
    redirect(processUrl(process.key, { error: error.message }));
  }

  refresh(process.key);
  redirect(processUrl(process.key, { saved: reset ? "message_reset" : "message_saved" }));
}

export async function saveNotificationLeadTimeAction(formData: FormData) {
  let process;
  try {
    process = requiredProcess(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "notification_process_unavailable";
    redirect(listUrl("procesos", { error: message }));
  }

  const minutes = Number(String(formData.get("minutes_before") ?? "").trim());
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) {
    redirect(processUrl(process.key, { error: "notification_timing_out_of_range" }));
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const { error } = await supabase.rpc("admin_update_notification_rules_lead_time", {
    p_studio_id: studio.id,
    p_rule_keys: [...process.ruleKeys],
    p_minutes_before: minutes,
  });

  if (error) {
    redirect(processUrl(process.key, { error: error.message }));
  }

  refresh(process.key);
  redirect(processUrl(process.key, { saved: "timing_saved" }));
}

export async function saveNotificationPreferencesAction(formData: FormData) {
  const window = String(formData.get("send_window") ?? "").trim();
  const weeklyLimit = Number(String(formData.get("marketing_weekly_limit") ?? "").trim());

  if (window && !/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(window)) {
    redirect(listUrl("preferencias", { error: "notification_send_window_invalid" }));
  }

  if (!Number.isInteger(weeklyLimit) || weeklyLimit < 1 || weeklyLimit > 14) {
    redirect(listUrl("preferencias", { error: "notification_marketing_limit_invalid" }));
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const { error } = await supabase.rpc("admin_save_notification_settings", {
    p_studio_id: studio.id,
    p_push_enabled: formData.has("push_enabled"),
    p_whatsapp_enabled: formData.has("whatsapp_enabled"),
    p_email_enabled: formData.has("email_enabled"),
    p_non_urgent_send_window: window || null,
    p_marketing_weekly_limit: weeklyLimit,
  });

  if (error) {
    redirect(listUrl("preferencias", { error: error.message }));
  }

  revalidatePath("/admin/notificaciones");
  redirect(listUrl("preferencias", { saved: "preferences" }));
}

function marketingUrl(marketingKey: string, params: Record<string, string> = {}) {
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return `/admin/notificaciones/marketing/${encodeURIComponent(marketingKey)}${suffix}`;
}

function parseMarketingCatalogCode(value: FormDataEntryValue | null): AutomationCatalogCode | null {
  const code = String(value ?? "").trim() as AutomationCatalogCode;
  try {
    getAutomationTemplate(code);
    return code;
  } catch {
    return null;
  }
}

const marketingNumericKeys = new Set([
  "days_before_expiration",
  "inactivity_days",
  "elapsed_since_expiration",
]);

function parseMarketingAutomationConfiguration(code: AutomationCatalogCode, formData: FormData) {
  const template = getAutomationTemplate(code);
  const configuration: Record<string, unknown> = {};

  for (const key of template.configurableParameters) {
    const raw = String(formData.get(`config_${key}`) ?? "").trim();
    if (!raw) continue;

    if (marketingNumericKeys.has(key)) {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`invalid_number:${key}`);
      }
      configuration[key] = value;
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

export async function saveMarketingCommunicationAction(formData: FormData) {
  const marketingKey = String(formData.get("marketing_key") ?? "").trim();
  const item = getMarketingCommunication(marketingKey);

  if (!item) {
    redirect(listUrl("marketing", { error: "marketing_invalid" }));
  }

  const audience = String(formData.get("audience_key") ?? item.defaultAudience).trim();
  const sendWindow = String(formData.get("send_window") ?? "").trim();
  const title = String(formData.get("title_template") ?? "").trim();
  const body = String(formData.get("body_template") ?? "").trim();
  const ctaLabel = String(formData.get("cta_label") ?? "").trim();
  const ctaHref = String(formData.get("cta_href") ?? "").trim();

  if (sendWindow && !/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(sendWindow)) {
    redirect(marketingUrl(marketingKey, { error: "notification_send_window_invalid" }));
  }

  if (!title || !body) {
    redirect(marketingUrl(marketingKey, { error: "marketing_message_required" }));
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const { error } = await supabase.rpc("admin_save_notification_marketing_config", {
    p_studio_id: studio.id,
    p_marketing_key: marketingKey,
    p_status: "draft",
    p_audience_key: audience,
    p_send_window: sendWindow || null,
    p_push_enabled: formData.has("push_enabled"),
    p_whatsapp_enabled: formData.has("whatsapp_enabled"),
    p_email_enabled: formData.has("email_enabled"),
    p_title_template: title,
    p_body_template: body,
    p_cta_label: ctaLabel || null,
    p_cta_href: ctaHref || null,
  });

  if (error) {
    redirect(marketingUrl(marketingKey, { error: error.message }));
  }

  revalidatePath("/admin/notificaciones");
  revalidatePath(`/admin/notificaciones/marketing/${marketingKey}`);
  redirect(marketingUrl(marketingKey, { saved: "marketing_draft" }));
}

export async function saveMarketingAutomationConfigurationAction(formData: FormData) {
  const marketingKey = String(formData.get("marketing_key") ?? "").trim();
  const item = getMarketingCommunication(marketingKey);
  const code = parseMarketingCatalogCode(formData.get("catalog_code"));
  const instanceId = String(formData.get("instance_id") ?? "").trim();

  if (!item || !code || !instanceId || !(item.automationCodes ?? []).includes(code)) {
    redirect(listUrl("marketing", { error: "marketing_automation_invalid" }));
  }

  let configuration: Record<string, unknown>;
  try {
    configuration = parseMarketingAutomationConfiguration(code, formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "configuration_invalid";
    redirect(marketingUrl(marketingKey, { error: message }));
  }

  const { supabase } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const { data, error } = await supabase.rpc("admin_update_automation_instance_configuration", {
    p_instance_id: instanceId,
    p_configuration: configuration,
  });

  if (error || data == null) {
    redirect(marketingUrl(marketingKey, { error: error?.message ?? "update_failed" }));
  }

  revalidatePath("/admin/notificaciones");
  revalidatePath(`/admin/notificaciones/marketing/${marketingKey}`);
  redirect(marketingUrl(marketingKey, { saved: "automation_configuration" }));
}

export async function transitionMarketingAutomationAction(formData: FormData) {
  const marketingKey = String(formData.get("marketing_key") ?? "").trim();
  const item = getMarketingCommunication(marketingKey);
  const code = parseMarketingCatalogCode(formData.get("catalog_code"));
  const instanceId = String(formData.get("instance_id") ?? "").trim();
  const nextState = String(formData.get("next_state") ?? "").trim();

  if (
    !item ||
    !code ||
    !instanceId ||
    !(item.automationCodes ?? []).includes(code) ||
    !["active", "paused"].includes(nextState)
  ) {
    redirect(listUrl("marketing", { error: "marketing_automation_invalid" }));
  }

  const { supabase } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const rpcName =
    nextState === "active"
      ? "admin_activate_automation_instance"
      : "admin_pause_automation_instance";

  const { error } = await supabase.rpc(rpcName, { p_instance_id: instanceId });
  if (error) {
    redirect(marketingUrl(marketingKey, { error: error.message }));
  }

  revalidatePath("/admin/notificaciones");
  revalidatePath(`/admin/notificaciones/marketing/${marketingKey}`);
  redirect(marketingUrl(marketingKey, { saved: nextState }));
}
