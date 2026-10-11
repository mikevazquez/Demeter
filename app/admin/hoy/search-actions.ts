"use server";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
export type PersonSearchResult = {
  id: string;
  full_name: string;
  phone: string | null;
  inactive: boolean;
  stage: string;
  href: string;
};
export async function searchPeople(query: string): Promise<PersonSearchResult[]> {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.STUDENTS_READ);
  const { data, error } = await supabase.rpc("admin_search_people", {
    target_studio_id: studio.id,
    q: query.slice(0, 120),
  });
  if (error) throw new Error("search_unavailable");
  return (data ?? []) as PersonSearchResult[];
}
export async function markAllAttended(sessionId: string) {
  const { supabase } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { data, error } = await supabase.rpc("bulk_mark_attended", {
    target_session_id: sessionId,
  });
  return error
    ? { ok: false, message: "No pudimos marcar la asistencia." }
    : (data as { ok: boolean; count: number; batch_id: string });
}
export async function undoMarkAll(batchId: string) {
  const { supabase } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { data, error } = await supabase.rpc("undo_bulk_mark_attended", {
    target_batch_id: batchId,
  });
  return error ? { ok: false } : (data as { ok: boolean; count: number });
}
