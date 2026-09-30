"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function paymentsPath(params?: Record<string, string>) {
  const query = new URLSearchParams(params);
  return query.size ? `/admin/configuracion/pagos?${query.toString()}` : "/admin/configuracion/pagos";
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

export async function createPaymentMethodAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  if (ctx.membership.role !== "owner") redirect("/admin?error=access");

  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "other").trim();
  if (name.length < 2 || name.length > 60) redirect(paymentsPath({ error: "name" }));
  if (!["cash", "transfer", "card", "digital", "other"].includes(category)) {
    redirect(paymentsPath({ error: "category" }));
  }

  const { data: last } = await ctx.supabase
    .from("studio_payment_methods")
    .select("sort_order")
    .eq("studio_id", ctx.studio.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const code = `custom_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const { error } = await ctx.supabase.from("studio_payment_methods").insert({
    studio_id: ctx.studio.id,
    code,
    name,
    category,
    active: true,
    requires_reference: checked(formData, "requires_reference"),
    allow_refunds: checked(formData, "allow_refunds"),
    sort_order: Math.min((last?.sort_order ?? 90) + 10, 1000),
    is_system: false,
  });

  if (error) redirect(paymentsPath({ error: "save" }));

  revalidatePath("/admin/configuracion/pagos");
  revalidatePath("/admin/ventas");
  redirect(paymentsPath({ saved: "created" }));
}

export async function updatePaymentMethodAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  if (ctx.membership.role !== "owner") redirect("/admin?error=access");

  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!code || name.length < 2 || name.length > 60) {
    redirect(paymentsPath({ error: "name" }));
  }

  const { error } = await ctx.supabase
    .from("studio_payment_methods")
    .update({
      name,
      requires_reference: checked(formData, "requires_reference"),
      allow_refunds: checked(formData, "allow_refunds"),
      updated_at: new Date().toISOString(),
    })
    .eq("studio_id", ctx.studio.id)
    .eq("code", code);

  if (error) redirect(paymentsPath({ error: "save" }));

  revalidatePath("/admin/configuracion/pagos");
  revalidatePath("/admin/ventas");
  redirect(paymentsPath({ saved: "updated" }));
}

export async function togglePaymentMethodAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  if (ctx.membership.role !== "owner") redirect("/admin?error=access");

  const code = String(formData.get("code") ?? "").trim();
  const nextActive = String(formData.get("next_active") ?? "") === "1";
  if (!code) redirect(paymentsPath({ error: "save" }));

  if (!nextActive) {
    const { count } = await ctx.supabase
      .from("studio_payment_methods")
      .select("code", { count: "exact", head: true })
      .eq("studio_id", ctx.studio.id)
      .eq("active", true);

    if ((count ?? 0) <= 1) redirect(paymentsPath({ error: "last_active" }));
  }

  const { error } = await ctx.supabase
    .from("studio_payment_methods")
    .update({ active: nextActive, updated_at: new Date().toISOString() })
    .eq("studio_id", ctx.studio.id)
    .eq("code", code);

  if (error) redirect(paymentsPath({ error: "save" }));

  revalidatePath("/admin/configuracion/pagos");
  revalidatePath("/admin/ventas");
  redirect(paymentsPath({ saved: nextActive ? "activated" : "deactivated" }));
}
