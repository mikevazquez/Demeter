import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMetaWhatsAppAdminDiagnostics } from "@/lib/assistant/meta-whatsapp-admin";

export async function campaignWhatsAppReadiness(studioId: string, client: SupabaseClient) {
  const diagnostics = await getMetaWhatsAppAdminDiagnostics(studioId);
  const name = diagnostics.templateMappings.manual_campaign ?? null;
  const template = diagnostics.templates.find(
    (t) => t.name === name && t.language === diagnostics.templateLanguage,
  );
  const { data: provider } = await client
    .from("notification_studio_channel_providers")
    .select("provider_key")
    .eq("studio_id", studioId)
    .eq("channel_key", "whatsapp")
    .eq("enabled", true)
    .eq("is_default", true)
    .maybeSingle();
  return {
    ready:
      diagnostics.connected &&
      provider?.provider_key === "meta_whatsapp" &&
      template?.status === "APPROVED" &&
      template.category === "MARKETING" &&
      template.variableCount === 2,
    templateName: name,
  };
}
