import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { contactConversations } from "@/lib/student-crm-conversations";
import { channelLabel } from "@/lib/student-crm";
import ContactConversation from "../../ContactConversation";
import { saveContactProfile } from "./actions";

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<{ view?: string; edit?: string; saved?: string; error?: string }>;
}) {
  const [{ contactId }, query, { supabase, studio, can }] = await Promise.all([
    params,
    searchParams,
    getAdminContext(CAPABILITIES.STUDENTS_READ),
  ]);
  const { data: contact } = await supabase
    .from("crm_contacts")
    .select("id,person_id,converted_student_id,created_at")
    .eq("studio_id", studio.id)
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) notFound();
  if (contact.converted_student_id) redirect(`/admin/alumnas/${contact.converted_student_id}`);
  const [{ data: person }, { data: contacts }, communications] = await Promise.all([
    supabase
      .from("persons")
      .select("first_name,last_name")
      .eq("studio_id", studio.id)
      .eq("id", contact.person_id)
      .maybeSingle(),
    supabase
      .from("person_contacts")
      .select("kind,value,is_primary")
      .eq("studio_id", stud¶»§q«^