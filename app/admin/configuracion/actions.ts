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

function identityConfigurationPath(formData: FormData, params?: Record<string, string>) {
  const target =
    String(formData.get("return_to") ?? "").trim() === "appearance"
      ? "/admin/configuracion/apariencia"
      : "/admin/configuracion";
  const query = new URLSearchParams(params);
  return query.size ? `${target}?${query.toString()}` : target;
}

function regionalConfigurationPath(formData: FormData, params?: Record<string, string>) {
  const target =
    String(formData.get("return_to") ?? "").trim() === "region"
      ? "/admin/configuracion/region"
      : "/admin/configuracion";
  const query = new URLSearchParams(params);
  return query.size ? `${target}?${query.toString()}` : target;
}

export async function saveStudioPortalIdentityAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const name = String(formData.get("name") ?? "").trim();
  const tagline = String(formData.get("tagline") ?? "").trim();
  const primaryColor = String(
    formData.get("primary_color") ?? ctx.studio.primary_color ?? "#FF0A8A",
  )
    .trim()
    .toUpperCase();
  const removeLogo = String(formData.get("remove_logo") ?? "") === "1";
  const logo = formData.get("logo");

  if (name.length < 2 || name.length > 80) {
    redirect(identityConfigurationPath(formData, { error: "name" }));
  }

  if (tagline.length > 120) {
    redirect(identityConfigurationPath(formData, { error: "tagline" }));
  }

  if (!/^#[0-9A-F]{6}$/.test(primaryColor)) {
    redirect(identityConfigurationPath(formData, { error: "primary_color" }));
  }

  let nextLogoPath = removeLogo ? null : (ctx.studio.logo_path ?? null);
  let uploadedLogoPath: string | null = null;

  if (logo instanceof File && logo.size > 0) {
    const extension = extensionByMime[logo.type];

    if (!extension) {
      redirect(identityConfigurationPath(formData, { error: "logo_type" }));
    }

    if (logo.size > MAX_LOGO_BYTES) {
      redirect(identityConfigurationPath(formData, { error: "logo_size" }));
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
      redirect(identityConfigurationPath(formData, { error: "logo_upload" }));
    }

    nextLogoPath = uploadedLogoPath;
  }

  const { error: updateError } = await ctx.supabase.rpc(
    "owner_update_studio_portal_branding_v2_release",
    {
      p_studio_id: ctx.studio.id,
      p_name: name,
      p_logo_path: nextLogoPath,
      p_tagline: tagline || null,
      p_primary_color: primaryColor,
    },
  );

  if (updateError) {
    if (uploadedLogoPath) {
      await ctx.supabase.storage.from("studio-branding").remove([uploadedLogoPath]);
    }

    console.error("[studio.branding] Branding update failed", {
      code: updateError.code,
      message: updateError.message.slice(0, 160),
    });
    redirect(identityConfigurationPath(formData, { error: "identity_save" }));
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
  revalidatePath("/admin/configuracion/apariencia");

  redirect(identityConfigurationPath(formData, { saved: "identity" }));
}

export async function saveStudioRegionalSettingsAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const timezone = String(formData.get("timezone") ?? "").trim();
  const currency = String(formData.get("currency") ?? "")
    .trim()
    .toUpperCase();
  const locale = String(formData.get("locale") ?? "").trim();
  const phoneCountryCallingCode = String(formData.get("phone_country_calling_code") ?? "").trim();

  if (
    !timezone ||
    !/^[A-Z]{3}$/.test(currency) ||
    locale.length < 2 ||
    locale.length > 20 ||
    !/^\+[1-9][0-9]{0,3}$/.test(phoneCountryCallingCode)
  ) {
    redirect(regionalConfigurationPath(formData, { error: "regional" }));
  }

  const { error } = await ctx.supabase.rpc("owner_update_studio_regional_settings_v2_release", {
    p_studio_id: ctx.studio.id,
    p_timezone: timezone,
    p_currency: currency,
    p_locale: locale,
    p_phone_country_calling_code: phoneCountryCallingCode,
  });

  if (error) {
    console.error("[studio.region] Regional settings update failed", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    redirect(regionalConfigurationPath(formData, { error: "regional_save" }));
  }

  revalidatePath("/admin");
  revalidatePath("/admin/configuracion/region");
  redirect(regionalConfigurationPath(formData, { saved: "regional" }));
}


export async function saveStudioBankTransferSettingsAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const enabled = String(formData.get("enabled") ?? "") === "1";
  const bankName = String(formData.get("bank_name") ?? "").trim();
  const accountHolder = String(formData.get("account_holder") ?? "").trim();
  const clabe = String(formData.get("clabe") ?? "").replace(/\D/g, "");
  const accountNumber = String(formData.get("account_number") ?? "").replace(/\D/g, "");
  const cardNumber = String(formData.get("card_number") ?? "").replace(/\D/g, "");
  const instructions = String(formData.get("instructions") ?? "").trim();

  const hasDestination = Boolean(clabe || accountNumber || cardNumber);
  const invalid =
    (enabled && (!bankName || !accountHolder || !hasDestination)) ||
    (clabe && !/^[0-9]{18}$/.test(clabe)) ||
    (accountNumber && !/^[0-9]{4,20}$/.test(accountNumber)) ||
    (cardNumber && !/^[0-9]{12,19}$/.test(cardNumber)) ||
    bankName.length > 80 ||
    accountHolder.length > 120 ||
    instructions.length > 300;

  if (invalid) {
    redirect("/admin/configuracion/pagos?error=transfer");
  }

  const { error } = await ctx.supabase
    .from("studio_bank_transfer_settings")
    .upsert(
      {
        studio_id: ctx.studio.id,
        enabled,
        bank_name: bankName || null,
        account_holder: accountHolder || null,
        clabe: clabe || null,
        account_number: accountNumber || null,
        card_number: cardNumber || null,
        instructions: instructions || null,
        updated_at: new Date().toISOString(),
        updated_by: ctx.user.id,
      },
      { onConflict: "studio_id" },
    );

  if (error) {
    console.error("[studio.payments] Bank transfer settings save failed", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    redirect("/admin/configuracion/pagos?error=transfer_save");
  }

  revalidatePath("/admin/configuracion/pagos");
  revalidatePath("/admin/mas");
  redirect("/admin/configuracion/pagos?saved=transfer");
}
