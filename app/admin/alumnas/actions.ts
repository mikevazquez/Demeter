"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { normalizeMexicanPhone } from "@/lib/phone";

export async function createStudent(formData: FormData) {
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const email =
    String(formData.get("email") ?? "")
      .trim()
      .toLowerCase() || null;
  const phone = normalizeMexicanPhone(String(formData.get("phone") ?? ""));

  if (!firstName || !phone) redirect("/admin/alumnas?error=student_phone");

  const { supabase } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const { error } = await supabase.rpc("admin_create_student", {
    p_first_name: firstName,
    p_last_name: lastName || null,
    p_phone: phone,
    p_email: email,
  });

  if (error) {
    const code = error.message.includes("phone_exists") ? "phone_exists" : "student";
    redirect(`/admin/alumnas?error=${code}`);
  }

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

  if (
    !name ||
    !Number.isInteger(validityDays) ||
    validityDays <= 0 ||
    !Number.isFinite(pricePesos) ||
    pricePesos < 0 ||
    (classCredits !== null && (!Number.isInteger(classCredits) || classCredits <= 0))
  ) {
    redirect("/admin/alumnas?error=package");
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.PRODUCTS_WRITE);
  const { error } = await supabase.from("packages").insert({
    studio_id: studio.id,
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
  if (!studentId || !packageId || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn))
    redirect("/admin/alumnas?error=assignment");

  const { supabase, studio } = await getAdminContext(CAPABILITIES.PRODUCTS_WRITE);
  const [{ data: student }, { data: packageRecord }] = await Promise.all([
    supabase
      .from("students")
      .select("id, user_id")
      .eq("id", studentId)
      .eq("studio_id", studio.id)
      .single(),
    supabase
      .from("packages")
      .select("id, class_credits, validity_days")
      .eq("id", packageId)
      .eq("studio_id", studio.id)
      .eq("active", true)
      .single(),
  ]);

  if (!student || !packageRecord) redirect("/admin/alumnas?error=assignment");

  const [year, month, day] = startsOn.split("-").map(Number);
  const expiry = new Date(Date.UTC(year, month - 1, day));
  expiry.setUTCDate(expiry.getUTCDate() + packageRecord.validity_days - 1);
  const expiresOn = expiry.toISOString().slice(0, 10);

  const { error } = await supabase.from("student_packages").insert({
    studio_id: studio.id,
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
