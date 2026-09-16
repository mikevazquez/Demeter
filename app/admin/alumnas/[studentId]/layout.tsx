import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { StudentAccessProvisioner } from "./StudentAccessProvisioner";

export default async function StudentProfileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.STUDENTS_READ);

  if (!can(CAPABILITIES.SETTINGS_WRITE)) return children;

  const { data: student } = await supabase
    .from("students")
    .select("id, user_id, phone, active, lifecycle_status")
    .eq("id", studentId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!student) return children;

  let account: { status: string; must_change_password: boolean } | null = null;
  let membership: { role: string; active: boolean; person_id: string | null } | null = null;

  if (student.user_id) {
    const [{ data: accountData }, { data: membershipData }] = await Promise.all([
      supabase
        .from("user_accounts")
        .select("status, must_change_password")
        .eq("id", student.user_id)
        .maybeSingle(),
      supabase
        .from("studio_memberships")
        .select("role, active, person_id")
        .eq("studio_id", studio.id)
        .eq("user_id", student.user_id)
        .maybeSingle(),
    ]);
    account = accountData;
    membership = membershipData;
  }

  const accessHealthy =
    Boolean(student.user_id) &&
    account?.status === "active" &&
    membership?.role === "student" &&
    membership.active;

  return (
    <>
      {children}
      <div className="dashboard-shell pt-0">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PORTAL DE ALUMNA</p>
              <h2>Cuenta de acceso</h2>
            </div>
            <span className="count-badge">{accessHealthy ? "Activa" : "Sin acceso"}</span>
          </div>

          {accessHealthy ? (
            <div className="student-list">
              <div className="student-row">
                <div>
                  <strong>Acceso vinculado correctamente</strong>
                  <span>Auth → user_accounts → membresía Student → expediente de alumna.</span>
                </div>
              </div>
              <div className="student-row">
                <div>
                  <strong>Contraseña</strong>
                  <span>
                    {account?.must_change_password
                      ? "Pendiente de reemplazar la contraseña temporal en el primer inicio de sesión."
                      : "Activación completada por la alumna."}
                  </span>
                </div>
              </div>
            </div>
          ) : student.user_id ? (
            <div className="notice error">
              El expediente tiene un vínculo de usuario incompleto o inconsistente. No se creará otra
              cuenta automáticamente; hay que corregir el enlace existente.
            </div>
          ) : student.active && student.lifecycle_status === "active" ? (
            <StudentAccessProvisioner studentId={student.id} phone={student.phone} />
          ) : (
            <div className="empty-state">
              El acceso sólo puede habilitarse mientras el expediente de la alumna esté activo.
            </div>
          )}
        </section>
      </div>
    </>
  );
}
