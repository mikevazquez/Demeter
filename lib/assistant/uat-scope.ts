import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MetaWhatsAppWebhookConfig,
  MetaDownloadedMedia,
  MetaTextDeliveryResult,
} from "./meta-whatsapp-channel";
import { assertDemiUatEnvironment } from "./uat-environment";
import type { MetaInboxWebhookConfig } from "./meta-inbox-channel";

type Scope = {
  runId: string;
  studioId: string;
  supabase: SupabaseClient;
  config: MetaWhatsAppWebhookConfig;
  media: Map<string, MetaDownloadedMedia>;
  metaInboxConfig?: MetaInboxWebhookConfig;
};
const storage = new AsyncLocalStorage<Scope>();

// Only authenticated Sandbox actions establish this scope; incoming HTTP headers cannot.
export function withDemiUatScope<T>(scope: Scope, action: () => Promise<T>) {
  assertDemiUatEnvironment(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.VERCEL_ENV);
  return storage.run(scope, action);
}

export function demiUatScope(studioId?: string) {
  const scope = storage.getStore();
  if (!scope) return null;
  assertDemiUatEnvironment(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.VERCEL_ENV);
  if (studioId && studioId !== scope.studioId) throw new Error("demi_uat_tenant_mismatch");
  return scope;
}

export async function captureDemiUatText(input: {
  config: MetaWhatsAppWebhookConfig;
  recipientWaId: string;
  text: string;
}): Promise<MetaTextDeliveryResult | null> {
  const scope = demiUatScope();
  if (!scope) return null;
  if (scope.config !== input.config) throw new Error("demi_uat_channel_mismatch");
  const { data, error } = await scope.supabase.rpc("service_capture_demi_uat_delivery", {
    p_studio: scope.studioId,
    p_kind: "whatsapp_reply",
    p_payload: { recipient: input.recipientWaId, text: input.text, captured: true },
  });
  if (error || !data) throw new Error("demi_uat_capture_failed");
  if (data.failed)
    return {
      status: "error",
      errorCode: "demi_uat_injected_delivery_failure",
      retryable: true,
      httpStatus: 503,
      responseSnapshot: data,
    };
  return {
    status: "accepted",
    providerMessageId: `uat:${data.artifact_id}`,
    httpStatus: 200,
    responseSnapshot: data,
  };
}
