"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import {
  getMetaWhatsAppAdminDiagnostics,
  submitMetaWhatsAppTemplate,
} from "@/lib/assistant/meta-whatsapp-admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  isMetaWhatsAppTemplateKey,
  metaTemplateKeyForNotification,
  META_WHATSAPP_TEMPLATE_PARAMETERS,
} from "@/lib/notifications/meta-template-catalog";
import { getChannelReadiness, type OutboundChannel } from "@/lib/notifications/channel-readiness";
import { getAutomationTemplate, type AutomationCatalogCode } from "@/lib/automations/catalog";
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
  if (channel === "inbox" || channel === "push" || channel === "whatsapp" || channel === "email")
    return channel;
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
  if (process.essential && !enabled) {
    redirect(processUrl(process.key, { error: "notification_process_essential" }));
  }

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

  if (channel === "inbox") {
    redirect(processUrl(process.key, { error: "notification_inbox_required" }));
  }

  const enabled = String(formData.get("next_enabled") ?? "") === "true";
  const { supabase, studio } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);

  if (enabled && channel === "email") {
    redirect(processUrl(process.key, { error: "notification_email_provider_not_configured" }));
  }

  if (enabled && channel === "push") {
    const { error: vapidError } = await createServiceClient().rpc("service_get_push_vapid_config");
    if (vapidError) {
      redirect(processUrl(process.key, { error: "notification_push_provider_not_configured" }));
    }
  }

  if (enabled && channel === "whatsapp") {
    const [{ data: snapshot }, diagnostics] = await Promise.all([
      supabase.rpc("admin_notification_rules_snapshot", { p_studio_id: studio.id }),
      getMetaWhatsAppAdminDiagnostics(studio.id),
    ]);
    const snapshotRules =
      snapshot &&
      typeof snapshot === "object" &&
      Array.isArray((snapshot as Record<string, unknown>).rules)
        ? ((snapshot as Record<string, unknown>).rules as Array<Record<string, unknown>>)
        : [];
    const templateKeys = process.ruleKeys.map((ruleKey) => {
      const rule = snapshotRules.find((row) => row.rule_key === ruleKey);
      return typeof rule?.template_key === "string"
        ? metaTemplateKeyForNotification(rule.template_key)
        : null;
    });
    const allMappedAndApproved =
      diagnostics.connected &&
      templateKeys.length > 0 &&
      templateKeys.every((templateKey) => {
        if (!templateKey) return false;
        if (!isMetaWhatsAppTemplateKey(templateKey)) return false;
        const metaName = diagnostics.templateMappings[templateKey];
        if (!metaName) return false;
        return diagnostics.templates.some(
          (template) =>
            template.name === metaName &&
            template.language === diagnostics.templateLanguage &&
            template.status === "APPROVED" &&
            template.variableCount === META_WHATSAPP_TEMPLATE_PARAMETERS[templateKey].length,
        );
      });
    if (!allMappedAndApproved) {
      redirect(processUrl(process.key, { error: "notification_whatsapp_template_not_approved" }));
    }
  }

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

export async function submitNotificationWhatsAppTemplateAction(formData: FormData) {
  let process;
  try {
    process = requiredProcess(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "notification_process_unavailable";
    redirect(listUrl("procesos", { error: message }));
  }

  const templateKey = String(formData.get("template_key") ?? "").trim();
  const name = String(formData.get("meta_template_name") ?? "")
    .trim()
    .toLowerCase();
  const languageCode = String(formData.get("language_code") ?? "").trim();
  const category = String(formData.get("meta_category") ?? "UTILITY")
    .trim()
    .toUpperCase();
  const body = String(formData.get("meta_body") ?? "").trim();
  if (!isMetaWhatsAppTemplateKey(templateKey)) {
    redirect(processUrl(process.key, { error: "notification_whatsapp_template_unsupported" }));
  }
  if (category !== "UTILITY" && category !== "MARKETING") {
    redirect(processUrl(process.key, { error: "meta_template_category_invalid" }));
  }

  const { studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  try {
    await submitMetaWhatsAppTemplate({
      studioId: studio.id,
      name,
      languageCode,
      category,
      body,
      expectedVariables: META_WHATSAPP_TEMPLATE_PARAMETERS[templateKey].length,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "meta_template_submission_failed";
    const safe =
      /^meta_(?:template_[a-z_]+|graph_http_\d{3}(?:_code_\d+)?(?:_subcode_\d+)?|graph_timeout|whatsapp_not_configured)$/.test(
        code,
      )
        ? code
        : "meta_template_submission_failed";
    redirect(processUrl(process.key, { error: safe }));
  }

  refresh(process.key);
  redirect(processUrl(process.key, { saved: "whatsapp_template_submitted" }));
}

export async function mapApprovedNotificationWhatsAppTemplateAction(formData: FormData) {
  let process;
  try {
    process = requiredProcess(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "notification_process_unavailable";
    redirect(listUrl("procesos", { error: message }));
  }

  const templateKey = String(formData.get("template_key") ?? "").trim();
  const templateName = String(formData.get("meta_template_name") ?? "").trim();
  const languageCode = String(formData.get("language_code") ?? "").trim();
  if (!isMetaWhatsAppTemplateKey(templateKey) || !/^[a-z0-9_]+$/.test(templateName)) {
    redirect(processUrl(process.key, { error: "notification_whatsapp_template_invalid" }));
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const diagnostics = await getMetaWhatsAppAdminDiagnostics(studio.id);
  const approved = diagnostics.templates.some(
    (template) =>
      template.name === templateName &&
      template.language === languageCode &&
      template.status === "APPROVED" &&
      template.variableCount === META_WHATSAPP_TEMPLATE_PARAMETERS[templateKey].length,
  );
  if (!diagnostics.connected || languageCode !== diagnostics.templateLanguage || !approved) {
    redirect(processUrl(process.key, { error: "notification_whatsapp_template_not_approved" }));
  }

  const { data: connection, error: connectionError } = await supabase.rpc(
    "admin_get_meta_whatsapp_connection_summary",
    { target_studio_id: studio.id },
  );
  const current =
    connection && typeof connection === "object" ? (connection as Record<string, unknown>) : {};
  const currentTemplates =
    current.templates && typeof current.templates === "object" && !Array.isArray(current.templates)
      ? (current.templates as Record<string, string>)
      : {};
  if (connectionError || current.connected !== true) {
    redirect(processUrl(process.key, { error: "meta_whatsapp_not_configured" }));
  }

  const { error } = await supabase.rpc("admin_update_meta_whatsapp_templates", {
    target_studio_id: studio.id,
    target_language_code: languageCode,
    target_country_calling_code:
      typeof current.country_calling_code === "string" ? current.country_calling_code : "52",
    target_templates: { ...currentTemplates, [templateKey]: templateName },
  });
  if (error)
    redirect(processUrl(process.key, { error: "notification_whatsapp_template_mapping_failed" }));

  refresh(process.key);
  redirect(processUrl(process.key, { saved: "whatsapp_template_mapped" }));
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

const PACKAGE_RECOVERY_RULES = new Map([
  ["marketing.package_recovery_1", "package-recovery-1"],
  ["marketing.package_recovery_2", "package-recovery-2"],
]);

export async function savePackageRecoveryDelayAction(formData: FormData) {
  const marketingKey = String(formData.get("marketing_key") ?? "").trim();
  if (!["package-recovery-1", "package-recovery-2"].includes(marketingKey)) {
    redirect(listUrl("marketing", { error: "package_recovery_rule_invalid" }));
  }

  const days = Number(String(formData.get("first_delay_days") ?? "").trim());
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    redirect(marketingUrl(marketingKey, { error: "package_recovery_delay_out_of_range" }));
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const { error } = await supabase.rpc("admin_update_package_recovery_delay", {
    p_studio_id: studio.id,
    p_first_days: days,
  });
  if (error) redirect(marketingUrl(marketingKey, { error: error.message }));

  revalidatePath("/admin/notificaciones");
  revalidatePath(marketingUrl("package-recovery-1"));
  revalidatePath(marketingUrl("package-recovery-2"));
  redirect(marketingUrl(marketingKey, { saved: "package_recovery_delay" }));
}

export async function updatePackageRecoveryRuleAction(formData: FormData) {
  const ruleKey = String(formData.get("rule_key") ?? "").trim();
  const marketingKey = PACKAGE_RECOVERY_RULES.get(ruleKey);
  const operation = String(formData.get("operation") ?? "").trim();
  if (!marketingKey || !["enabled", "channel"].includes(operation)) {
    redirect(listUrl("marketing", { error: "package_recovery_rule_invalid" }));
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.AUTOMATIONS_MANAGE);
  const enabled = String(formData.get("next_enabled") ?? "") === "true";
  const channel = String(formData.get("channel") ?? "").trim();

  const [{ data: rawSnapshot }, pushConfig, diagnostics] = await Promise.all([
    supabase.rpc("admin_notification_rules_snapshot", { p_studio_id: studio.id }),
    operation === "enabled" || (operation === "channel" && channel === "push")
      ? createServiceClient().rpc("service_get_push_vapid_config")
      : Promise.resolve({ error: null }),
    operation === "enabled" || (operation === "channel" && channel === "whatsapp")
      ? getMetaWhatsAppAdminDiagnostics(studio.id)
      : Promise.resolve(null),
  ]);
  const snapshot =
    rawSnapshot && typeof rawSnapshot === "object" && !Array.isArray(rawSnapshot)
      ? (rawSnapshot as {
          rules?: Array<Record<string, unknown>>;
          settings?: Record<string, unknown>;
        })
      : {};
  const rule = snapshot.rules?.find((row) => row.rule_key === ruleKey);
  if (!rule) redirect(marketingUrl(marketingKey, { error: "package_recovery_rule_not_seeded" }));

  const templateKey = metaTemplateKeyForNotification(String(rule.template_key ?? ""));
  const templateName = templateKey ? diagnostics?.templateMappings[templateKey] : null;
  const template = templateName
    ? diagnostics?.templates.find(
        (candidate) =>
          candidate.name === templateName && candidate.language === diagnostics?.templateLanguage,
      )
    : null;
  const readiness = getChannelReadiness({
    globalEnabled: {
      push: snapshot.settings?.push_enabled !== false,
      whatsapp: snapshot.settings?.whatsapp_enabled === true,
      email: snapshot.settings?.email_enabled === true,
    },
    pushProviderConfigured: !pushConfig.error,
    whatsappConnected: diagnostics?.connected === true,
    whatsappTemplateName: templateName ?? null,
    whatsappTemplateLanguage: template?.language ?? diagnostics?.templateLanguage ?? "",
    whatsappTemplateStatus: template?.status ?? null,
    whatsappTemplateVariables: template?.variableCount ?? null,
    expectedWhatsappVariables:
      templateKey && isMetaWhatsAppTemplateKey(templateKey)
        ? META_WHATSAPP_TEMPLATE_PARAMETERS[templateKey].length
        : null,
    emailProviderConfigured: false,
  });

  if (operation === "channel") {
    if (!(channel === "push" || channel === "whatsapp" || channel === "email")) {
      redirect(marketingUrl(marketingKey, { error: "notification_channel_invalid" }));
    }
    if (enabled && !readiness[channel].ready) {
      redirect(marketingUrl(marketingKey, { error: `channel_not_ready_${channel}` }));
    }
    const { error } = await supabase.rpc("admin_set_notification_rules_channel", {
      p_studio_id: studio.id,
      p_rule_keys: [ruleKey],
      p_channel_key: channel,
      p_enabled: enabled,
    });
    if (error) redirect(marketingUrl(marketingKey, { error: error.message }));
  } else {
    if (enabled) {
      const channels = Array.isArray(rule.channels) ? rule.channels : [];
      const selected = channels
        .map((item) =>
          item && typeof item === "object"
            ? String((item as Record<string, unknown>).channel_key ?? "")
            : "",
        )
        .filter((item) => item && item !== "inbox");
      if (selected.some((item) => item === "push" && !readiness.push.ready)) {
        redirect(marketingUrl(marketingKey, { error: "channel_not_ready_push" }));
      }
      if (selected.some((item) => item === "whatsapp" && !readiness.whatsapp.ready)) {
        redirect(marketingUrl(marketingKey, { error: "channel_not_ready_whatsapp" }));
      }
      if (selected.some((item) => item === "email" && !readiness.email.ready)) {
        redirect(marketingUrl(marketingKey, { error: "channel_not_ready_email" }));
      }
    }
    const { error } = await supabase.rpc("admin_set_notification_rules_enabled", {
      p_studio_id: studio.id,
      p_rule_keys: [ruleKey],
      p_enabled: enabled,
    });
    if (error) redirect(marketingUrl(marketingKey, { error: error.message }));
  }

  revalidatePath("/admin/notificaciones");
  revalidatePath(marketingUrl(marketingKey));
  redirect(
    marketingUrl(marketingKey, { saved: `${operation}_${enabled ? "enabled" : "disabled"}` }),
  );
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
  const selectedChannels: OutboundChannel[] = ["push", "whatsapp", "email"].filter((channel) =>
    formData.has(`${channel}_enabled`),
  ) as OutboundChannel[];
  if (selectedChannels.length) {
    const [{ data: rawSnapshot }, pushConfig, diagnostics] = await Promise.all([
      supabase.rpc("admin_notification_rules_snapshot", { p_studio_id: studio.id }),
      formData.has("push_enabled")
        ? createServiceClient().rpc("service_get_push_vapid_config")
        : Promise.resolve({ error: null }),
      formData.has("whatsapp_enabled")
        ? getMetaWhatsAppAdminDiagnostics(studio.id)
        : Promise.resolve(null),
    ]);
    const snapshot =
      rawSnapshot && typeof rawSnapshot === "object" && !Array.isArray(rawSnapshot)
        ? (rawSnapshot as { settings?: Record<string, unknown> })
        : {};
    const settings = snapshot.settings ?? {};
    const templateKey = item.whatsappTemplateKey;
    const templateName = templateKey ? diagnostics?.templateMappings[templateKey] : null;
    const template = templateName
      ? diagnostics?.templates.find(
          (candidate) =>
            candidate.name === templateName && candidate.language === diagnostics?.templateLanguage,
        )
      : null;
    const readiness = getChannelReadiness({
      globalEnabled: {
        push: settings.push_enabled !== false,
        whatsapp: settings.whatsapp_enabled === true,
        email: settings.email_enabled === true,
      },
      pushProviderConfigured: !pushConfig.error,
      whatsappConnected: diagnostics?.connected === true,
      whatsappTemplateName: templateName ?? null,
      whatsappTemplateLanguage: template?.language ?? diagnostics?.templateLanguage ?? "",
      whatsappTemplateStatus: template?.status ?? null,
      whatsappTemplateVariables: template?.variableCount ?? null,
      expectedWhatsappVariables:
        templateKey && isMetaWhatsAppTemplateKey(templateKey)
          ? META_WHATSAPP_TEMPLATE_PARAMETERS[templateKey].length
          : null,
      emailProviderConfigured: false,
    });
    const unavailable = selectedChannels.find((channel) => !readiness[channel].ready);
    if (unavailable) {
      redirect(marketingUrl(marketingKey, { error: `channel_not_ready_${unavailable}` }));
    }
  }

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
