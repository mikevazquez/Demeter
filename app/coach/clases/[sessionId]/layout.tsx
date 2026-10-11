import { notFound, redirect } from "next/navigation";
import { getCoachContext } from "@/lib/auth/coach-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { localDateKey, type CoachSessionDetail } from "@/lib/coach/portal";

export default async function LegacyCoachClassLayout({
  params,
}: {
  params: Promise<{ sessionId: string }>;
  children: React.ReactNode;
}) {
  const { sessionId } = await params;
  const { supabase, studio } = await getCoachContext(CAPABILITIES.SCHEDULE_READ);
  const { data, error } = await supabase.rpc("coach_session_detail", {
    target_studio_id: studio.id,
    target_session_id: sessionId,
  });
  if (error || !data) notFound();
  const detail = data as CoachSessionDetail;
  const date = localDateKey(new Date(detail.starts_at), studio.timezone);
  redirect(`/admin/mis-clases?date=${date}#session-${sessionId}`);
}
