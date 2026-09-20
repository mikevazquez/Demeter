import { redirect } from "next/navigation";

export default async function LegacyCoachLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  redirect(error ? `/login/studio?error=${encodeURIComponent(error)}` : "/login/studio");
}
