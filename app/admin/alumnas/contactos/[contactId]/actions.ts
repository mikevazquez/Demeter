"use server";

import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { normalizeMexicanPhone } from "@/lib/phone";

function contactRedirect(contactId: string, params: string): never {
  redirect("/admin/alumnas/contactos/" + contactId + "?" + params);
}

export async function saveContactProfile(formData: FormData) {
  const contactId = String(formData.get("contact_id") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const phone = normalizeMexicanPhone(rawPhone);
  const rawEmail = String(formData.get("email") ?? "").trim().toLowerCase();
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
    .eq("id", contactId)
    .maybeSingle();

  if (!contact) redirect("/admin/alumnas?error=contact_not_found");
  if (contact.converted_student_id) redirect("/admin/alumnas/" + contact.converted_student_id);

  const { data: duplicatePhone } = await supabase
    .from("person_contacts")
    .select("person_id")
    .eq("studio_id", studio.id)
    .eq("kind", "phone")
    .eq("value", phone)
    .neq("person_id", contact.person_id)
    .limit(1)
    .maybeSingle();
  if (duplicatePhone) contactRedirect(contactId, "view=summary&edit=1&error=phone_exists");

  const { error: personError } = await supabase
    .from("persons")
    .update({ first_name: firstName, last_name: lastName || null })
    .eq("studio_id", studio.id)
    .eq("id", contact.person_id);
  if (personError) contactRedirect(contactId, "view=summary&edit=1&error=save_failed");

  const { data: phoneContact, error: phoneReadError } = await supabase
    .from("person_contacts")
    .select("id")
    .eq("studio_id", studio.id)
    .eq("person_id", contact.person_id)
    .eq("kind", "phone")
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (phoneReadError) contactRedirect(contactId, "view=summary&edit=1&error=save_failed");

  const phoneWrite = phoneContact
    ? await supabase.from("person_contacts").update({ value: phone, is_primary: true }).eq("id", phoneContact.id)
    : await supabase.from("person_contacts").insert({
        studio_id: studio.id,
        person_id: contact.person_id,
        kind: "phone",
        value: phone,
        is_primary: true,
      });
  if (phoneWrite.error) contactRedirect(contactId, "view=summary&edit=1&error=save_failed");

  const { data: emailContact, error: emailReadError } = await supabase
    .from("person_contacts")
    .select("id")
    .eq("studio_id", studio.id)
    .eq("person_id", contact.person_id)
    .eq("kind", "email")
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (emailReadError) contactRedirect(contactId, "view=summary&edit=1&error=save_failed");

  if (email) {
    const emailWrite = emailContact
      ? await supabase.from("person_contacts").update({ value: email, is_primary: true }).eq("id", emailContact.id)
      : await supabase.from("person_contacts").insert({
          studio_id: studio.id,
          person_id: contact.person_id,
          kind: "email",
          value: email,
          is_primary: true,
        });
    if (emailWrite.error) contactRedirect(contactId, "view=summary&edit=1&error=save_failed");
  } else if (emailContact) {
    const { error } = await supabase.from("person_contacts").delete().eq("id", emailContact.id);
    if (error) contactRedirect(contactId, "view=summary&edit=1&error=save_failed");
  }

  contactRedirect(contactId, "view=summary&saved=1");
}
