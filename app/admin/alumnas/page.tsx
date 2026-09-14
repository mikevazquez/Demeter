import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assignPackage, createPackage, createStudent } from "./actions";

function money(cents: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(cents / 100);
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login/admin");

  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("studio_id, role")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!membership || !["owner", "admin", "coach"].includes(membership.role)) redirect("/login/admin?error=access");

  const [{ data: studio }, { data: students }, { data: packages }, { data: assignments }] = await Promise.all([
    supabase.from("studios").select("name").eq("id", membership.studio_id).single(),
    supabase.from("students").select("id, full_name, email, phone, active").eq("studio_id", membership.studio_id).order("full_name"),
    supabase.from("packages").select("id, name, class_credits, validity_days, price_cents, active").eq("studio_id", membership.studio_id).order("name"),
    supabase.from("student_packages").select("id, student_id, package_id, credits_remaining, credits_total, starts_on, expires_on").eq("studio_id", membership.studio_id).order("expires_on", { ascending: false }),
  ]);

  const canEdit = ["owner", "admin"].includes(membership.role);
  const packageMap = new Map((packages ?? []).map((item) => [item.id, item]));
  const assignmentsByStudent = new Map<string, (typeof assignments extends (infer T)[] | null ? T[] : never)>();
  for (const assignment of assignments ?? []) {
    if (!assignment.student_id) continue;
    const list = assignmentsByStudent.get(assignment.student_id) ?? [];
    list.push(assignment);
    assignmentsByStudent.set(assignment.student_id, list);
  }
  const today = new Date().toISOString().slice(0, 10);

  const errorMessage = params.error === "student_phone"
    ? "El teléfono es obligatorio. Ingresa 10 dígitos de México o un número internacional con código de país."
    : params.error === "phone_exists"
      ? "Ya existe una alumna con ese teléfono en este estudio."
      : params.error
        ? "No se pudo guardar. Revisa los datos e inténtalo de nuevo."
        : null;

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin">← Hoy</Link>
          <p className="eyebrow">ALUMNAS · {studio?.name ?? "ESTUDIO"}</p>
          <h1 className="dashboard-title">Alumnas y paquetes</h1>
          <p>Administra expedientes básicos, catálogo de paquetes y vigencias.</p>
        </div>
        <div className="toolbar-actions"><span className="role-pill">{membership.role}</span></div>
      </header>

      {params.created ? <div className="notice success">Cambio guardado correctamente.</div> : null}
      {errorMessage ? <div className="notice error">{errorMessage}</div> : null}

      <section className="agenda-layout">
        <div className="agenda-main">
          <article className="panel">
            <div className="panel-heading">
              <div><p className="eyebrow">DIRECTORIO</p><h2>Alumnas activas</h2></div>
              <span className="count-badge">{students?.filter((s) => s.active).length ?? 0}</span>
            </div>

            {(students?.length ?? 0) === 0 ? (
              <div className="empty-state">Aún no hay alumnas. Crea la primera desde el panel de la derecha.</div>
            ) : (
              <div className="student-list">
                {students?.map((student) => {
                  const activeAssignments = (assignmentsByStudent.get(student.id) ?? []).filter((item) => item.expires_on >= today);
                  const current = activeAssignments[0];
                  const currentPackage = current ? packageMap.get(current.package_id) : null;
                  return (
                    <div className="student-row" key={student.id}>
                      <div>
                        <strong>{student.full_name}</strong>
                        <span>{student.phone}{student.email ? ` · ${student.email}` : ""}</span>
                      </div>
                      <div className="student-package-summary">
                        <strong>{currentPackage?.name ?? "Sin paquete activo"}</strong>
                        <span>{current ? `${current.credits_remaining ?? "∞"} clases · vence ${current.expires_on}` : "Asigna un paquete para reservar"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>

          <article className="panel">
            <div className="panel-heading"><div><p className="eyebrow">CATÁLOGO</p><h2>Paquetes</h2></div><span className="count-badge">{packages?.length ?? 0}</span></div>
            <div className="package-grid">
              {packages?.map((item) => (
                <div className="package-card" key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{item.class_credits ?? "Ilimitadas"} clases · {item.validity_days} días</span>
                  <small>{money(item.price_cents)}</small>
                </div>
              ))}
            </div>
          </article>
        </div>

        <aside className="agenda-sidebar">
          {!canEdit ? <article className="panel"><p>Tu rol puede consultar alumnas y paquetes, pero solo owner y admin pueden modificarlos.</p></article> : (
            <>
              <article className="panel compact-panel">
                <p className="eyebrow">1 · ALUMNA</p>
                <h2>Nueva alumna</h2>
                <form action={createStudent} className="compact-form">
                  <input name="full_name" required placeholder="Nombre completo" autoComplete="name" />
                  <input name="phone" type="tel" inputMode="tel" required placeholder="Teléfono · 10 dígitos" autoComplete="tel" aria-describedby="student-phone-help" />
                  <small id="student-phone-help">Obligatorio. Se guarda como +52 y será el identificador de acceso de la alumna.</small>
                  <input name="email" type="email" placeholder="Correo opcional" autoComplete="email" />
                  <button className="primary-button" type="submit">Agregar alumna</button>
                </form>
              </article>

              <article className="panel compact-panel">
                <p className="eyebrow">2 · PAQUETE</p>
                <h2>Nuevo paquete</h2>
                <form action={createPackage} className="compact-form">
                  <input name="name" required placeholder="Ej. 12 clases" />
                  <div className="form-split">
                    <input name="class_credits" type="number" min="1" placeholder="Clases" aria-label="Créditos; vacío para ilimitado" />
                    <input name="validity_days" type="number" min="1" defaultValue="30" required aria-label="Vigencia en días" />
                  </div>
                  <input name="price_pesos" type="number" min="0" step="1" required placeholder="Precio MXN" />
                  <button className="primary-button" type="submit">Crear paquete</button>
                </form>
              </article>

              <article className="panel compact-panel">
                <p className="eyebrow">3 · ASIGNAR</p>
                <h2>Activar paquete</h2>
                <form action={assignPackage} className="compact-form">
                  <select name="student_id" required defaultValue=""><option value="" disabled>Alumna</option>{students?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
                  <select name="package_id" required defaultValue=""><option value="" disabled>Paquete</option>{packages?.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  <input name="starts_on" type="date" required defaultValue={today} />
                  <button className="primary-button" type="submit" disabled={!students?.length || !packages?.length}>Asignar paquete</button>
                </form>
              </article>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
