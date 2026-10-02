import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import StudentOnboardingForm from "../../alumnas/[studentId]/alta/StudentOnboardingForm";
import { createEnrollmentOnlySaleAction } from "../actions";

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
  const [query, { supabase, studio }] = await Promise.all([
    searchParams,
    getAdminContext(CAPABILITIES.SALES_WRITE),
  ]);
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
    <main className="sales-v2 sales-v2-new">
      <header className="sales-v2-header sales-v2-new-header">
        <div>
          <Link
            className="sales-v2-back"
            href={selectedStudent ? `/admin/alumnas/${selectedStudent.id}` : "/admin/alumnas"}
          >
            ← Perfil de alumna
          </Link>
          <h1>Nueva venta</h1>
          <p>Selecciona la alumna y registra lo que compró y cómo pagó.</p>
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
      ) : !selectedStudentId ? (
        <section className="sales-v2-student-picker">
          <div>
            <span>Primero</span>
            <h2>¿A quién le vas a vender?</h2>
            <p>Busca o selecciona una alumna para continuar.</p>
          </div>
          <div className="sales-v2-student-picker-list">
            {(students ?? []).map((student) => (
              <Link key={student.id} href={`/admin/ventas/nueva?student_id=${student.id}`}>
                <strong>{student.full_name}</strong>
                {student.phone ? <small>{student.phone}</small> : null}
                <span aria-hidden="true">›</span>
              </Link>
            ))}
          </div>
        </section>
      ) : !selectedStudent ? (
        <section className="module-empty">
          La alumna seleccionada no está disponible para registrar una venta.
        </section>
      ) : (
        <>
          <section className="sales-v2-student-context">
            <div>
              <span>Alumna</span>
              <strong>{selectedStudent.full_name}</strong>
              {selectedStudent.phone ? <small>{selectedStudent.phone}</small> : null}
            </div>
            <Link href="/admin/ventas/nueva">Cambiar alumna</Link>
          </section>

          {!currentEnrollment && (enrollmentProducts ?? []).length > 0 ? (
            <section className="panel sales-v2-enrollment-only">
              <p className="eyebrow">INSCRIPCIÓN</p>
              <h2>¿Solo necesita pagar la inscripción?</h2>
              <p>Registra la inscripción sin comprar ni modificar ningún paquete de la alumna.</p>
              <form action={createEnrollmentOnlySaleAction} className="compact-form mt-4">
                <input type="hidden" name="student_id" value={selectedStudent.id} />
                <label>
                  <span>Inscripción</span>
                  <select
                    name="enrollment_product_id"
                    defaultValue={
                      policy?.enrollment_product_template_id ?? enrollmentProducts?.[0]?.id ?? ""
                    }
                    required
                  >
                    {(enrollmentProducts ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ·{" "}
                        {item.validity_days == null ? "Vitalicia" : `${item.validity_days} días`} ·{" "}
                        {new Intl.NumberFormat(studio.locale, {
                          style: "currency",
                          currency: item.currency,
                        }).format(item.price_minor / 100)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Pago recibido</span>
                  <input
                    name="payment_amount"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={
                      ((
                        enrollmentProducts?.find(
                          (item) => item.id === policy?.enrollment_product_template_id,
                        ) ?? enrollmentProducts?.[0]
                      )?.price_minor ?? 0) / 100
                    }
                  />
                </label>
                <label>
                  <span>Cómo pagó</span>
                  <select name="payment_method" required defaultValue="">
                    <option value="" disabled>
                      Seleccionar
                    </option>
                    <option value="Efectivo">Efectivo</option>
                    <option value="Transferencia">Transferencia</option>
                    <option value="Tarjeta">Tarjeta</option>
                    <option value="Otro">Otro</option>
                  </select>
                </label>
                <label>
                  <span>Referencia opcional</span>
                  <input name="payment_reference" />
                </label>
                <label>
                  <span>Nota opcional</span>
                  <input name="payment_notes" />
                </label>
                <button className="primary-button">Pagar solo inscripción</button>
              </form>
            </section>
          ) : null}

          <StudentOnboardingForm
            studentId={selectedStudent.id}
            studentName={selectedStudent.full_name}
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
