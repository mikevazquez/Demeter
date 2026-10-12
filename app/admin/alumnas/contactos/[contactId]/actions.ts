"use server";

import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { normalizeMexicanPhone } from "@/lib/phone";

function contactRedirect(contactId: string, params: string): never {
  redirect(`/admin/alumnas/contactos/${contactId}?${params}`);
}

export async function saveContactProfile(formData: FormData) {
  const contactId = String(formData.get("contact_id") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const phone = normalizeMexicanPhone(rawPhone);
  const rawEmail = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const email = rawEmail || null;

  if (!contactId) redirect("/admin/alumnas?error=contact_missing");
  if (!firstName) contactRedirect(contactId, "view=summary&edit=1&error=first_name_required");
  if (!phone) contactRedirect(contactId, "view=summary&edit=1&error=phone_invalid");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    contactRedirect(contactId, "view=summary&edit=1&error=email_invalid");
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const { data: contact } = await supabase
    .from("crm_contacts")
    .select("person_id,converted_student_id")
    .eq("studio_id", studio.id)
    .eq("id", co¶»§q«^