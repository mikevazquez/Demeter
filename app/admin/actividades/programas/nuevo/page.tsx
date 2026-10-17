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
  const isMasterclass = query.kind === "masterclass";
  const isEvent = query.kind === "event";
  return (
    <main className="activities-v2 activities-editor-page">
      <Link className="activities-v2-back" href={isMasterclass ? "/admin/actividades?tipo=masterclass" : isEvent ? "/admin/actividades?tipo=eventos" : "/admin/actividades?tipo=talleres"}>← Volver</Link>
      <header className="activities-v2-header">
        <div>
          <h1>{isMasterclass ? "Nueva master class" : isEvent ? "Nuevo evento" : "Nuevo programa"}</h1>
          <p>Configura la información, fechas, cupos y precios. Las sesiones se incorporan a Agenda.</p>
        </div>
      </header>
      <ProgramForm
        disciplines={disciplines ?? []}
        instructors={(instructors ?? []).map((i) => ({
          id: i.id,
          name: names.get(i.person_id) ?? "Coach",
        }))}
        spaces={spaces ?? []}
        kind={isMasterclass ? "masterclass" : isEvent ? "event" : "workshop"}
      />
    </main>
  );
}
