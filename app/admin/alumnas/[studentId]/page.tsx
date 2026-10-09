import { redirect, notFound } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
export default async function LegacyStudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ studentId }, query, { supabase, studio }] = await Promise.all([
    params,
    searchParams,
    getAdminContext(CAPABILITIES.STUDENTS_READ),
  ]);
  const { data: student, error } = await supabase
    .from("students")
    .select("person_id,archived_at")
    .eq("id", studentId)
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (error) throw new Error("crm_identity_unavailable");
  if (!student?.person_id || student.archived_at) notFound();
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (typeof value === "string") next.set(key, value);
  next.set("tab", "profile");
  redirect(`/admin/crm/${student.person_id}?${next}`);
}
