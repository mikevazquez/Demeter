"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { createServiceClient } from "@/lib/supabase/service";
import {
  sendProviderEmail,
  type EmailConnection,
} from "@/supabase/functions/_shared/email-provider";
export async function connectEmailAction(form: FormData) {
  const { studio, user } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const provider = String(form.get("provider") ?? "");
  const from = String(form.get("from_email") ?? "").trim();
  const to = String(form.get("test_email") ?? "").trim();
  let secret = String(form.get("api_key") ?? "").trim();
  const region = String(form.get("region") ?? "us-east-1");
  if (
    !["resend", "sendgrid", "ses"].includes(provider) ||
    ![from, to].every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    redirect("/admin/integraciones/correo?error=invalid");
  if (provider === "ses")
    secret = JSON.stringify({
      accessKeyId: String(form.get("access_key_id") ?? "").trim(),
      secretAccessKey: secret,
    });
  let accepted = false;
  try {
    accepted = (
      await sendProviderEmail(
        { provider: provider as EmailConnection["provider"], from_email: from, secret, region },
        to,
        "Prueba de correo de StudioFlow",
        "Tu estudio ya puede enviar comunicaciones desde este remitente.",
      )
    ).ok;
  } catch {}
  if (!accepted) redirect("/admin/integraciones/correo?error=test");
  const { error } = await createServiceClient().rpc("service_save_email_connection", {
    p_studio_id: studio.id,
    p_actor_id: user.id,
    p_provider: provider,
    p_from_email: from,
    p_region: region,
    p_secret: secret,
  });
  if (error) redirect("/admin/integraciones/correo?error=save");
  revalidatePath("/admin/integraciones");
  revalidatePath("/admin/comunicacion");
  redirect("/admin/integraciones/correo?saved=1");
}
