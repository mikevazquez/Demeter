import { redirect } from "next/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) p.set(k, v);
  redirect(`/admin/recompensas/retos?${p}`);
}
