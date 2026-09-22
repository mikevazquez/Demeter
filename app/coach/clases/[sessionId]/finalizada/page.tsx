import { redirect } from "next/navigation";

export default async function LegacyCoachFinalizedPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  redirect(`/admin#session-${sessionId}`);
}
