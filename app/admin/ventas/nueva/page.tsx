import { randomUUID } from "node:crypto";
import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import StudentOnboardingForm from "../../alumnas/[studentId]/alta/StudentOnboardingForm";

function localDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

const errorCopy: Record<string, string> = {
  invalid_request: "Faltan datos para registrar la venta.",
  student_not_operable: "La alumna no está activa para registrar una venta.",
  package_not_available: "El paquete seleccionado ya no está disponible.",
  product_validity_missing: "El paquete no tiene una vigencia válida configurada.",
  package_start_mode_invalid: "Selecciona cómo inicia la vigencia del paquete.",
  package_start_date_required: "Selecciona la fecha de inicio del paquete.",
  discount_invalid: "Revisa el descuento capturado.",
  discount_kind_invalid: "El tipo de descuento no es válido.",
  discount_reason_required: "Indica el motivo del descuento o cortesía.",
  prior_credits_unavailable_for_unlimited:
    "Un paquete ilimitado no admite consumos previos por número de créditos.",
  prior_credits_exceed_package: "Los consumos previos superan los créditos del paquete.",
  prior_credits_exceed_available: "Los consumos previos superan los créditos disponibles.",
  prior_credits_reason_required: "Indica el motivo de los consumos previos.",
  prior_credits_invalid: "Indica un número válido de créditos ya consumidos.",
  enrollment_resolution_required: "Resuelve la inscripción antes de confirmar la venta.",
  enrollment_product_not_configured:
    "La inscripción es obligatoria, pero falta configurar su producto.",
  enrollment_effective_date_required: "Indica la fecha efectiva de la inscripción.",
  enrollment_effective_date_future: "La fecha de inscripción no puede estar en el futuro.",
  enrollment_reason_required: "Indica el motivo de la promoción o excepción de inscripción.",
  enrollment_already_active: "La alumna ya tiene una inscripción vigente.",
  enrollment_not_required: "La inscripción no es obligatoria con la política actual.",
  enrollment_payment_required:
    "Para registrar la inscripción como pagada, el pago inicial debe cubrir al menos su importe.",
  payment_invalid: "Revisa el monto recibido.",
  payment_exceeds_balance: "El monto recibido no puede superar el total.",
  payment_method_required: "Selecciona el método de pago.",
  payment_effective_date_required: "Indica la fecha real del pago.",
  payment_effective_date_future: "La fecha del pago no puede estar en el futuro.",
  payment_followup_required:
    "Si queda saldo pendiente, registra una fecha compromiso o una nota de seguimiento.",
  payment_due_date_past: "La fecha compromiso no puede estar en el pasado.",
  pending_access_reason_required:
    "Indica por qué se autoriza usar el paquete sin haber recibido pago.",
  forbidden: "Tu cuenta no tiene permiso para registrar ventas.",
  onboarding_sale_failed: "No se pudo registrar la venta.",
};

export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ student_id?: string; error?: string }>;
}) {
  const query = await searchParams;
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SALES_WRITE);
  const selectedStudentId = String(query.student_id ?? "").trim();
  const today = localDate(studio.timezone);

  const { data: students } = await supabase
    .from("students")
    .select("id,full_name,phone")
    .eq("studio_id", studio.id)
    .eq("active", true)
    .eq("lifecycle_status", "active")
    .order("full_name");

  const selectedStudent =
    (students ?? []).find((student) => student.id === selectedStudentId) ?? null;

  const [
    { data: packages },
    { data: policy },
    { data: activeEnrollments },
    { data: enrollmentProducts },
  ] = selectedStudent
    ? await Promise.all([
        supabase
          .from("product_templates")
          .select("id,name,package_term,price_minor,currency,credit_limit,validity_days,unlimited")
          .eq("studio_id", studio.id)
          .in("product_type", ["package", "membership"])
          .eq("active", true)
          .order("price_minor"),
        supabase
          .from("enrollment_policies")
          .select("enabled,required_for_package_purchase,enrollment_product_template_id")
          .eq("studio_id", studio.id)
          .maybeSingle(),
        supabase
          .from("student_enrollments")
          .select("id,starts_on,expires_on,status")
          .eq("studio_id", studio.id)
          .eq("student_id", selectedStudent.id)
          .eq("status", "active"),
        supabase
          .from("product_templates")
          .select("id,name,price_minor,currency,validity_days")
          .eq("studio_id", studio.id)
          .eq("product_type", "enrollment")
          .eq("active", true)
          .order("name"),
      ])
    : [{ data: [] }, { data: null }, { data: [] }, { data: [] }];

  const enrollmentRequired = Boolean(policy?.enabled && policy.required_for_package_purchase);
  const currentEnrollment = (activeEnrollments ?? []).some(
    (item) => item.starts_on <= today && (item.expires_on === null || item.expires_on >= today),
  );

  return (
    <main className="dashboard-shell admin-module-page sale-page">
      <header className="module-header">
        <div>
          <Link
            className="back-link compact"
            href={selectedStudent ? `/admin/alumnas/${selectedStudent.id}` : "/admin"}
          >
            {selectedStudent ? "← Perfil 360" : "← Hoy"}
          </Link>
          <h1>Registrar venta</h1>
          <p>Mismo flujo comercial aprobado: alumna, paquete, condiciones, pago y confirmación.</p>
        </div>
      </header>

      {query.error ? (
        <div className="notice error">
          {errorCopy[decodeURIComponent(query.error)] ?? "No se pudo registrar la venta."}
        </div>
      ) : null}

      {!students?.length ? (
        <section className="module-empty">
          No hay alumnas activas disponibles para registrar una venta.
        </section>
      ) : !selectedStudent ? (
        <section className="sale-step-card">
          <div className="sale-step-layout">
            <span className="sale-step-number">1</span>
            <div className="sale-step-content">
              <h2>Selecciona la alumna</h2>
              <p>Después continuarás con el mismo flujo de venta ya aprobado.</p>
              <form method="get" className="compact-form mt-4">
                <label>
                  <span>Alumna</span>
                  <select name="student_id" required defaultValue="">
                    <option value="" disabled>
                      Selecciona una alumna
                    </option>
                    {(students ?? []).map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.full_name}
                        {student.phone ? ` · ${student.phone}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary-button" type="submit">
                  Continuar
                </button>
              </form>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="sale-context-card">
            <div>
              <span>Alumna</span>
              <strong>{selectedStudent.full_name}</strong>
              {selectedStudent.phone ? <small>{selectedStudent.phone}</small> : null}
            </div>
            <Link href="/admin/ventas/nueva">Cambiar alumna</Link>
          </section>

          <StudentOnboardingForm
            studentId={selectedStudent.id}
            studentName={selectedStudent.full_name}
            studioName={studio.name}
            locale={studio.locale}
            packages={(packages ?? []).map((item) => ({
              id: item.id,
              name: item.name,
              packageTerm: item.package_term,
              priceMinor: item.price_minor,
              currency: item.currency,
              creditLimit: item.credit_limit,
              validityDays: item.validity_days,
              unlimited: item.unlimited,
            }))}
            today={today}
            idempotencyKey={randomUUID()}
            enrollmentRequired={enrollmentRequired}
            currentEnrollment={currentEnrollment}
            enrollmentProducts={(enrollmentProducts ?? []).map((item) => ({
              id: item.id,
              name: item.name,
              priceMinor: item.price_minor,
              currency: item.currency,
              validityDays: item.validity_days,
            }))}
            defaultEnrollmentProductId={policy?.enrollment_product_template_id ?? null}
            completedSaleId={null}
            flowContext="sale"
          />
        </>
      )}
    </main>
  );
}
