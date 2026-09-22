import { redirect } from "next/navigation";

export default async function LegacyCoachSummaryPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  redirect(`/admin#session-${sessionId}`);
}
