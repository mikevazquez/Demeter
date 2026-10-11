import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Demi belongs to a studio. Channel adapters must use this configuration;
// channels do not own separate personalities, models or commercial policies.
export async function loadDemiRuntimeConfig(supabase: SupabaseClient, studioId: string) {
  const query = () =>
    supabase
      .from("assistant_configs")
      .select(
        "assistant_name,mode,model,reasoning_effort,personality_instructions,monthly_budget_usd_micros,conversation_budget_usd_micros,max_model_calls_per_turn,max_tool_calls_per_turn",
      )
      .eq("studio_id", studioId);

  const result = await query().eq("assistant_key", "demi").maybeSingle();
  // Older production schemas have one configuration per studio and no assistant_key.
  // Only that missing-column error permits a legacy lookup; other errors fail closed.
  if (result.error?.code === "42703" && result.error.message.includes("assistant_key")) {
    return query().maybeSingle();
  }
  return result;
}
