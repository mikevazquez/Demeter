import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { assertServiceTargetIsolation } from "@/lib/supabase/target-policy";

export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("supabase_service_role_not_configured");
  }

  assertServiceTargetIsolation({
    url: supabaseUrl,
    vercelEnv: process.env.VERCEL_ENV,
    candidatePreview: process.env.SF_GOV_CANDIDATE_PREVIEW,
  });

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function isServiceClientConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return false;
  try {
    assertServiceTargetIsolation({
      url,
      vercelEnv: process.env.VERCEL_ENV,
      candidatePreview: process.env.SF_GOV_CANDIDATE_PREVIEW,
    });
    return true;
  } catch {
    return false;
  }
}
