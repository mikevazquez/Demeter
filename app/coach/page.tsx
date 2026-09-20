import { redirect } from "next/navigation";

export default async function LegacyCoachHomePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams();
  if (query.date) params.set("date", query.date);
  if (query.error) params.set("error", query.error);
  const suffix = params.toString();
  redirect(suffix ? `/admin/mis-clases?${suffix}` : "/admin/mis-clases");
}
