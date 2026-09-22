import { redirect } from "next/navigation";

export default async function LegacyCoachClassPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  redirect(`/admin#session-${sessionId}`);
}
