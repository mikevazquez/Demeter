import { redirect } from "next/navigation";
export default async function AutomationIndex({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const query = await searchParams;
  const tab =
    query.tab === "preferences"
      ? "preferencias"
      : query.tab === "marketing"
        ? "marketing"
        : "secuencias";
  redirect(`/admin/comunicacion?tab=${tab}`);
}
