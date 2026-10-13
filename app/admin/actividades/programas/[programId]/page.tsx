import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { EnrollmentForm } from "./EnrollmentForm";
export default async function ProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ enrolled?: string }>;
}) {
  const [{ programId }, query, ctx] = await Promise.all([
    params,
    searchParams,
    getAdminContext("schedule.read"),
  ]);
  const [{ data: program }, { data: links }, { data: students }, { data: persons }] =
    await Promise.all([
      ctx.supabase
        .from("activity_programs")
        .select("*")
        .eq("studio_id", ctx.studio.id)
        .eq("id", programId)
        .maybeSingle(),
      ctx.supabase
        .from("activity_program_sessions")
        .select("session_id,single_product_id,position")
        .eq("studio_id", ctx.studio.id)
        .eq("program_id", programId)
        .order("position"),
      ctx.supabase
        .from("students")
        .select("id,person_id")
        .eq("studio_id", ctx.studio.id)
        .eq("active", true)
        .eq("lifecycle_status", "active"),
      ctx.supabase.from("persons").select("id,first_name,last_name").eq("studio_id", ctx.studio.id),
    ]);
  if (!program) notFound();
  const ids = (links ?? []).map((l) => l.session_id);
  const productIds = [
    program.full_product_id,
    ...(links ?? []).map((l) => l.single_product_id).filter(Boolean),
  ];
  const [
    { data: sessions },
    { data: products },
    { data: reservations },
    { data: templates },
    { data: disciplines },
  ] = await Promise.all([
    ctx.supabase
      .from("class_sessions")
      .select("id,template_id,starts_at,ends_at,capacity,status")
      .eq("studio_id", ctx.studio.id)
      .in("id", ids),
    ctx.supabase
      .from("product_templates")
      .select("id,price_minor")
      .eq("studio_id", ctx.studio.id)
      .in("id", productIds),
    ctx.supabase
      .from("reservations")
      .select("session_id,status")
      .eq("studio_id", ctx.studio.id)
      .in("session_id", ids)
      .in("status", ["reserved", "attended"]),
    ctx.supabase
      .from("class_templates")
      .select("id,discipline_id")
      .eq("studio_id", ctx.studio.id)
      .eq("program_id", programId),
    ctx.supabase.from("disciplines").select("id,name").eq("studio_id", ctx.studio.id),
  ]);
  const prices = new Map((products ?? []).map((p) => [p.id, p.price_minor]));
  const names = new Map(
    (persons ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name ?? ""}`.trim()]),
  );
  const disciplineNames = new Map((disciplines ?? []).map((d) => [d.id, d.name]));
  const templateNames = new Map(
    (templates ?? []).map((t) => [t.id, disciplineNames.get(t.discipline_id) ?? "Disciplina"]),
  );
  const money = (minor: number) =>
    new Intl.NumberFormat(ctx.studio.locale, {
      style: "currency",
      currency: ctx.studio.currency,
    }).format(minor / 100);
  const date = (value: string) =>
    new Intl.DateTimeFormat(ctx.studio.locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: ctx.studio.timezone,
    }).format(new Date(value));
  const rows = (links ?? [])
    .map((l) => ({ ...l, session: (sessions ?? []).find((s) => s.id === l.session_id)! }))
    .filter((l) => l.session);
  const options = [
    { id: "", name: `Programa completo · ${money(prices.get(program.full_product_id) ?? 0)}` },
    ...rows
      .filter((r) => r.single_product_id)
      .map((r) => ({
        id: r.session_id,
        name: `${date(r.session.starts_at)} · ${templateNames.get(r.session.template_id)} · ${money(prices.get(r.single_product_id) ?? 0)}`,
      })),
  ];
  return (
    <main className="activities-v2 activities-editor-page program-detail-page">
      <Link className="activities-v2-back" href="/admin/actividades">
        ← Actividades
      </Link>
      <header className="program-detail-summary">
        <div className="program-detail-heading">
          <span className="program-detail-kind">
            {program.kind === "event" ? "Evento especial" : "Taller o curso"}
          </span>
          <h1>{program.name}</h1>
          <span className="program-detail-count">
            {rows.length} {rows.length === 1 ? "fecha" : "fechas"}
          </span>
        </div>
        {program.description ? (
          <p className="program-detail-description">{program.description}</p>
        ) : null}
        <div className="program-detail-price">
          <span>Programa completo</span>
          <strong>{money(prices.get(program.full_product_id) ?? 0)}</strong>
        </div>
      </header>
      {query.enrolled ? (
        <p role="status" className="program-enrollment-success">
          <strong>Inscripción confirmada</strong>
          <span>El pago quedó registrado y el cupo está reservado en las fechas elegidas.</span>
        </p>
      ) : null}
      <section className="program-dates-section" aria-labelledby="program-dates-title">
        <div className="program-dates-heading">
          <h2 id="program-dates-title">Fechas del programa</h2>
          <span>{rows.length} sesiones</span>
        </div>
        <div className="program-dates-table-wrap">
          <table className="program-dates-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Disciplina</th>
                <th>Duración</th>
                <th>Disponibilidad</th>
                <th>Clase suelta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const used = (reservations ?? []).filter(
                  (b) => b.session_id === r.session_id,
                ).length;
                return (
                  <tr key={r.session_id}>
                    <td data-label="Fecha">
                      <Link href={`/admin/agenda/${r.session_id}`}>
                        {date(r.session.starts_at)}
                      </Link>
                    </td>
                    <td data-label="Disciplina">{templateNames.get(r.session.template_id)}</td>
                    <td data-label="Duración">
                      {(Date.parse(r.session.ends_at) - Date.parse(r.session.starts_at)) / 60000}{" "}
                      min
                    </td>
                    <td data-label="Lugares disponibles">
                      {r.session.status === "scheduled"
                        ? `${Math.max(0, r.session.capacity - used)} de ${r.session.capacity}`
                        : r.session.status}
                    </td>
                    <td data-label="Precio por fecha">
                      {r.single_product_id
                        ? money(prices.get(r.single_product_id) ?? 0)
                        : "Solo completo"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {ctx.can("sales.write") && ctx.can("schedule.write") ? (
        <EnrollmentForm
          programId={programId}
          students={(students ?? []).map((s) => ({
            id: s.id,
            name: names.get(s.person_id) ?? "Alumna",
          }))}
          options={options}
          requestId={randomUUID()}
        />
      ) : null}
    </main>
  );
}
