"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const extensionByMime: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function configurationPath(params?: Record<string, string>) {
  const query = new URLSearchParams(params);
  return query.size ? `/admin/configuracion?${query.toString()}` : "/admin/configuracion";
}

function checkboxValue(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

export async function saveStudioPortalIdentityAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const name = String(formData.get("name") ?? "").trim();
  const tagline = String(formData.get("tagline") ?? "").trim();
  const primaryColor = String(formData.get("primary_color") ?? "").trim().toUpperCase();
  const removeLogo = String(formData.get("remove_logo") ?? "") === "1";
  const logo = formData.get("logo");

  if (name.length < 2 || name.length > 80) {
    redirect(configurationPath({ error: "name" }));
  }

  if (tagline.length > 120) {
    redirect(configurationPath({ error: "tagline" }));
  }

  if (!/^#[0-9A-F]{6}$/.test(primaryColor)) {
    redirect(configurationPath({ error: "primary_color" }));
  }

  let nextLogoPath = removeLogo ? null : (ctx.studio.logo_path ?? null);
  let uploadedLogoPath: string | null = null;

  if (logo instanceof File && logo.size > 0) {
    const extension = extensionByMime[logo.type];

    if (!extension) {
      redirect(configurationPath({ error: "logo_type" }));
    }

    if (logo.size > MAX_LOGO_BYTES) {
      redirect(configurationPath({ error: "logo_size" }));
    }

    uploadedLogoPath = `${ctx.studio.id}/logo-${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await ctx.supabase.storage
      .from("studio-branding")
      .upload(uploadedLogoPath, logo, {
        contentType: logo.type,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("[studio.branding] Logo upload failed", {
        code: uploadError.name,
        message: uploadError.message.slice(0, 160),
      });
      redirect(configurationPath({ error: "logo_upload" }));
    }

    nextLogoPath = uploadedLogoPath;
  }

  const { error: updateError } = await ctx.supabase.rpc("owner_update_studio_portal_branding", {
    p_studio_id: ctx.studio.id,
    p_name: name,
    p_logo_path: nextLogoPath,
    p_tagline: tagline || null,
    p_primary_color: primaryColor,
  });

  if (updateError) {
    if (uploadedLogoPath) {
      await ctx.supabase.storage.from("studio-branding").remove([uploadedLogoPath]);
    }

    console.error("[studio.branding] Branding update failed", {
      code: updateError.code,
      message: updateError.message.slice(0, 160),
    });
    redirect(configurationPath({ error: "identity_save" }));
  }

  const previousLogoPath = ctx.studio.logo_path ?? null;
  if (previousLogoPath && previousLogoPath !== nextLogoPath) {
    const { error: deleteError } = await ctx.supabase.storage
      .from("studio-branding")
      .remove([previousLogoPath]);

    if (deleteError) {
      console.error("[studio.branding] Previous logo cleanup failed", {
        code: deleteError.name,
        message: deleteError.message.slice(0, 160),
      });
    }
  }

  revalidatePath("/");
  revalidatePath(`/s/${ctx.studio.slug}`);
  revalidatePath("/admin");
  revalidatePath("/admin/configuracion");

  redirect(configurationPath({ saved: "identity" }));
}

export async function saveStudioOperatingPolicyAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const cutoffHours = Number(formData.get("cancellation_cutoff_hours"));
  if (!Number.isFinite(cutoffHours) || cutoffHours < 0 || cutoffHours > 168) {
    redirect(configurationPath({ error: "cutoff" }));
  }

  const cutoffMinutes = Math.round(cutoffHours * 60);

  const { error } = await ctx.supabase.rpc("owner_update_studio_operating_policy", {
    p_studio_id: ctx.studio.id,
    p_cancellation_cutoff_minutes: cutoffMinutes,
    p_late_cancellation_consumes_credit: checkboxValue(
      formData,
      "late_cancellation_consumes_credit",
    ),
    p_no_show_consumes_credit: checkboxValue(formData, "no_show_consumes_credit"),
  });

  if (error) {
    console.error("[studio.policy] Operating policy update failed", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    redirect(configurationPath({ error: "operating_save" }));
  }

  revalidatePath("/admin/configuracion");
  redirect(configurationPath({ saved: "operating" }));
}

export async function saveStudioRegionalSettingsAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const timezone = String(formData.get("timezone") ?? "").trim();
  const currency = String(formData.get("currency") ?? "").trim().toUpperCase();
  const locale = String(formData.get("locale") ?? "").trim();

  if (!timezone || !/^[A-Z]{3}$/.test(currency) || locale.length < 2 || locale.length > 20) {
    redirect(configurationPath({ error: "regional" }));
  }

  const { error } = await ctx.supabase.rpc("owner_update_studio_regional_settings", {
    p_studio_id: ctx.studio.id,
    p_timezone: timezone,
    p_currency: currency,
    p_locale: locale,
  });

  if (error) {
    console.error("[studio.region] Regional settings update failed", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    redirect(configurationPath({ error: "regional_save" }));
  }

  revalidatePath("/admin");
  revalidatePath("/admin/configuracion");
  redirect(configurationPath({ saved: "regional" }));
}
