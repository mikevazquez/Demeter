import type { SupabaseClient } from "@supabase/supabase-js";
export async function emailProviderConfigured(supabase: SupabaseClient, studioId: string) {
  const { data, error } = await supabase.rpc("admin_email_connection_snapshot", {
    p_studio_id: studioId,
  });
  return !error && Boolean(data && typeof data === "object" && "tested_at" in data);
}
