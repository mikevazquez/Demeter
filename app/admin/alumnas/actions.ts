"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login/admin");

  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("studio_id, role")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/admin/alumnas?error=access");
  }

  return { supabase, studioId: membership.studio_id };
}

function normalizeMexicanPhone(value: string) {
  const raw = value.trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  let normalized: string;

  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    normalized = `+${digits}`;
  } else if (digits.length === 10) {
    normalized = `+52${digits}`;
  } else if (digits.length === 12 && digits.startsWith("52")) {
    normalized = `+${digits}`;
  } else {
    return null;
  }

  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : null;
}

export async function createStudent(formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  const phone = normalizeMexicanPhone(String(formData.get("phone") ?? ""));

  if (!fullName || !phone) redirect("/admin/alumnas?error=student_phone");

  const { supabase, studioId } = await requireAdmin();

  const { data: existing } = await supabase
    .from("students")
    .select("id")
    .eq("studio_id", studioId)
    .eq("phone", phone)
    .maybeSingle();

  if (existing) redirect("/admin/alumnas?error=phone_exists");

  const { error } = await supabase.from("students").insert({
    studio_id: studioId,
    full_name: fullName,
    email,
    phone,
  });

  if (error) redirect("/admin/alumnas?error=student");
  revalidatePath("/admin/alumnas");
  revalidatePath("/admin");
  redirect("/admin/alumnas?created=student");
}

export async function createPackage(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const creditsRaw = String(formData.get("class_credits") ?? "").trim();
  const validityDays = Number(formData.get("validity_days"));
  const pricePesos = Number(formData.get("price_pesos"));
  const classCredits = creditsRaw === "" ? null : Number(creditsRaw);

  if (!name || !Number.isInteger(validityDays) || validityDays <= 0 || !Number.isFinite(pricePesos) || pricePesos < 0 || (classCredits !== null && (!Number.isInteger(classCredits) || classCredits <= 0))) {
    redirect("/admin/alumnas?error=package");
  }

  const { supabase, studioId } = await requireAdmin();
  const { error } = await supabase.from("packages").insert({
    studio_id: studioId,
    name,
    class_credits: classCredits,
    validity_days: validityDays,
    price_cents: Math.round(pricePesos * 100),
  });

  if (error) redirect("/admin/alumnas?error=package");
  revalidatePath("/admin/alumnas");
  redirect("/admin/alumnas?created=package");
}

export async function assignPackage(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  const packageId = String(formData.get("package_id") ?? "");
  const startsOn = String(formData.get("starts_on") ?? "");
  if (!studentId || !packageId || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) redirect("/admin/alumnas?error=assignment");

  const { supabase, studioId } = await requireAdmin();
  const [{ data: student }, { data: packageRecord }] = await Promise.all([
    supabase.from("students").select("id, user_id").eq("id", studentId).eq("studio_id", studioId).single(),
    supabase.from("packages").select("id, class_credits, validity_days").eq("id", packageId).eq("studio_id", studioId).eq("active", true).single(),
  ]);

  if (!student || !packageRecord) redirect("/admin/alumnas?error=assignment");

  const [year, month, day] = startsOn.split("-").map(Number);
  const expiry = new Date(Date.UTC(year, month - 1, day));
  expiry.setUTCDate(expiry.getUTCDate() + packageRecord.validity_days - 1);
  const expiresOn = expiry.toISOString().slice(0, 10);

  const { error } = await supabase.from("student_packages").insert({
    studio_id: studioId,
    student_id: studentId,
    student_user_id: student.user_id,
    package_id: packageId,
    credits_total: packageRecord.class_credits,
    credits_remaining: packageRecord.class_credits,
    starts_on: startsOn,
    expires_on: expiresOn,
  });

  if (error) redirect("/admin/alumnas?error=assignment");
  revalidatePath("/admin/alumnas");
  revalidatePath("/admin");
  redirect("/admin/alumnas?created=assignment");
}
