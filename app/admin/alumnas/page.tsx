import { redirect } from "next/navigation";
export default async function LegacyStudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (typeof value === "string") next.set(key, value);
  redirect(`/admin/crm${next.size ? `?${next}` : ""}`);
}
