import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Demi belongs to a studio. Channel adapters must use this configuration;
// channels do not own separate personalities, models or commercial policies.
export async function loadDemiRuntimeConfig(supabase: SupabaseClient, studioId: string) {
  return supabase
    .from("assistant_configs")
    .select(
      "assistant_name,mode,model,reasoning_effort,personality_instructions,monthly_budget_usd_micros,conversation_budget_usd_micros,max_model_calls_per_turn,max_tool_calls_per_turn",
    )
    .eq("studio_id", studioId)
    .maybeSingle();
}
