import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import {
  StudentAccessProvisioner,
  StudentTemporaryPasswordResetter,
} from "./StudentAccessProvisioner";

export default async function StudentPortalAccessSection({ studentId }: { studentId: string }) {
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.STUDENTS_READ);

  if (!can(CAPABILITIES.SETTINGS_WRITE)) return null;

  const { data: student } = await supabase
    .from("students")
    .select("id,user_id,phone,active,lifecycle_status")
    .eq("id", studentId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!student) return null;

  let account: { status: string; must_change_password: boolean } | null = null;
  let membership: { role: string; active: boolean; person_id: string | null } | null = null;

  if (student.user_id) {
    const [{ data: accountData }, { data: membershipData }] = await Promise.all([
      supabase
        .from("user_accounts")
        .select("status,must_change_password")
        .eq("id", student.user_id)
        .maybeSingle(),
      supabase
        .from("studio_memberships")
        .select("role,active,person_id")
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
    membership?.active === true;

  return (
    <details className="profile360-detail">
      <summary>
        <span>
          <strong>Acceso al portal</strong>
          <small>Cuenta, activación y contraseña</small>
        </span>
        <span aria-hidden="true">›</span>
      </summary>

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
                <span>La cuenta está vinculada al expediente de esta alumna.</span>
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
            {account?.must_change_password ? (
              <StudentTemporaryPasswordResetter studentId={student.id} phone={student.phone} />
            ) : null}
          </div>
        ) : student.user_id ? (
          <div className="notice error">
            El expediente tiene un vínculo de usuario incompleto o inconsistente. Hay que corregir
            el enlace existente antes de crear otro acceso.
          </div>
        ) : student.active && student.lifecycle_status === "active" ? (
          <StudentAccessProvisioner studentId={student.id} phone={student.phone} />
        ) : (
          <div className="empty-state">
            El acceso sólo puede habilitarse mientras el expediente esté activo.
          </div>
        )}
      </section>
    </details>
  );
}
