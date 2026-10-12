import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { ProgramForm } from "./ProgramForm";
export default async function NewProgram({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const [ctx, query] = await Promise.all([getAdminContext("schedule.write"), searchParams]);
  const [{ data: disciplines }, { data: instructors }, { data: persons }, { data: spaces }] =
    await Promise.all([
      ctx.supabase
        .from("disciplines")
        .select("id,name")
        .eq("studio_id", ctx.studio.id)
        .eq("active", true)
        .order("name"),
      ctx.supabase
        .from("instructors")
        .select("id,person_id")
        .eq("studio_id", ctx.studio.id)
        .eq("status", "active"),
      ctx.supabase.from("persons").select("id,first_name,last_name").eq("studio_id", ctx.studio.id),
      ctx.supabase
        .from("spaces")
        .select("id,name")
        .eq("studio_id", ctx.studio.id)
        .eq("active", true),
    ]);
  const names = new Map(
    (persons ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name ?? ""}`.trim()]),
  );
  return (
    <main className="activities-v2 activities-editor-page">
      <Link href="/admin/actividades">← Actividades</Link>
      <h1>Nuevo taller o evento</h1>
      <ProgramForm
        disciplines={disciplines ?? []}
        instructors={(instructors ?? []).map((i) => ({
          id: i.id,
          name: names.get(i.person_id) ?? "Coach",
        }))}
        spaces={spaces ?? []}
        kind={query.kind === "event" ? "event" : "workshop"}
      />
    </main>
  );
}
