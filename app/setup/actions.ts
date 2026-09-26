"use server";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";

export type ProvisionStudioState = {
  status: "idle" | "success" | "error";
  message?: string;
  studioId?: string;
  studioSlug?: string;
  ownerEmail?: string;
  planKey?: string;
  activationRequired?: boolean;
  activationLink?: string | null;
  reusedExistingAccount?: boolean;
};

export const initialProvisionStudioState: ProvisionStudioState = {
  status: "idle",
};

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function errorMessage(code?: string) {
  switch (code) {
    case "studio_slug_exists":
      return "Ese slug ya está siendo usado por otro estudio.";
    case "owner_account_unavailable":
      return "Ese correo ya existe, pero la cuenta no está disponible para reutilizarse.";
    case "saas_plan_invalid":
    case "saas_plan_required":
      return "Selecciona un plan comercial válido.";
    case "forbidden":
      return "Tu cuenta no tiene permiso de plataforma para crear estudios.";
    case "invalid_request":
      return "Revisa los campos obligatorios y vuelve a intentarlo.";
    default:
      return "No pudimos crear el estudio. Revisa los datos e intenta nuevamente.";
  }
}

export async function provisionStudioAction(
  _previousState: ProvisionStudioState,
  formData: FormData,
): Promise<ProvisionStudioState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "error", message: "Tu sesión ya no está activa." };
  }

  const { data: platformAdmin } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!platformAdmin) {
    return { status: "error", message: "Tu cuenta no tiene permiso de plataforma." };
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";

  if (!host) {
    return { status: "error", message: "No pudimos resolver la URL de activación." };
  }

  const studioName = field(formData, "studio_name");
  const studioSlug = field(formData, "studio_slug").toLowerCase();
  const ownerName = field(formData, "owner_name");
  const ownerEmail = field(formData, "owner_email").toLowerCase();
  const planKey = field(formData, "plan_key").toLowerCase();

  if (!studioName || !studioSlug || !ownerName || !ownerEmail || !planKey) {
    return { status: "error", message: "Completa los campos obligatorios." };
  }

  const { data, error } = await supabase.functions.invoke("provision-studio", {
    body: {
      studioName,
      studioSlug,
      ownerName,
      ownerEmail,
      planKey,
      timezone: field(formData, "timezone") || "America/Mexico_City",
      currency: field(formData, "currency") || "MXN",
      locale: field(formData, "locale") || "es-MX",
      phoneCountryCallingCode:
        field(formData, "phone_country_calling_code") || "+52",
      primaryColor: field(formData, "primary_color") || "#FF0A8A",
      siteName: field(formData, "site_name") || "Principal",
      address: field(formData, "address"),
      spaceName: field(formData, "space_name") || "Sala principal",
      activationUrl: `${protocol}://${host}/login/studio/activar`,
    },
  });

  const payload = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    studio?: {
      studio_id?: string;
      plan_key?: string;
    };
    ownerEmail?: string;
    reusedExistingAccount?: boolean;
    activationRequired?: boolean;
    activationLink?: string | null;
  };

  if (error || !payload.ok) {
    return {
      status: "error",
      message: errorMessage(payload.error),
    };
  }

  return {
    status: "success",
    message: "Estudio creado correctamente.",
    studioId: payload.studio?.studio_id,
    studioSlug,
    ownerEmail: payload.ownerEmail ?? ownerEmail,
    planKey: payload.studio?.plan_key ?? planKey,
    activationRequired: payload.activationRequired === true,
    activationLink: payload.activationLink ?? null,
    reusedExistingAccount: payload.reusedExistingAccount === true,
  };
}
