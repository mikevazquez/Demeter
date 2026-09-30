import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import StudentOnboardingForm from "./StudentOnboardingForm";
import OnboardingCompletedDialog from "./OnboardingCompletedDialog";

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
  invalid_request: "Faltan datos para completar el alta.",
  student_not_operable: "La alumna no está activa. Resuelve su estado desde Perfil 360.",
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
  enrollment_resolution_required: "Resuelve la inscripción antes de completar la compra.",
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
  onboarding_sale_failed: "No se pudo completar la venta del alta.",
};

export default async function StudentOnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ error?: string; completed?: string; sale?: string }>;
}) {
  const { studentId } = await params;
  const query = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.STUDENTS_READ);

  const { data: student } = await supabase
    .from("students")
    .select("id,full_name,lifecycle_status,active,profile_status")
    .eq("id", studentId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!student) notFound();

  const today = localDate(studio.timezone);
  const canSell = can(CAPABILITIES.SALES_WRITE);

  const [
    { data: packages },
    { data: policy },
    { data: existingAcquisitions },
    { data: activeEnrollments },
    { data: enrollmentProducts },
  ] = await Promise.all([
    canSell
      ? supabase
          .from("product_templates")
          .select("id,name,package_term,price_minor,currency,credit_limit,validity_days,unlimited")
          .eq("studio_id", studio.id)
          .in("product_type", ["package", "membership"])
          .eq("active", true)
          .order("price_minor")
      : Promise.resolve({ data: [] }),
    canSell
      ? supabase
          .from("enrollment_policies")
          .select("enabled,required_for_booking,enrollment_product_template_id")
          .eq("studio_id", studio.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    canSell
      ? supabase
          .from("product_acquisitions")
          .select("id,status,refunded_at")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
    canSell
      ? supabase
          .from("student_enrollments")
          .select("id,starts_on,expires_on,status")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
    canSell
      ? supabase
          .from("product_templates")
          .select("id,name,price_minor,currency,validity_days")
          .eq("studio_id", studio.id)
          .eq("product_type", "enrollment")
          .eq("active", true)
          .order("name")
      : Promise.resolve({ data: [] }),
  ]);

  const enrollmentRequired = Boolean(policy?.enabled && policy.required_for_booking);
  const currentEnrollment = (activeEnrollments ?? []).some(
    (item) => item.starts_on <= today && (item.expires_on === null || item.expires_on >= today),
  );

  const alreadyHasPackage = (existingAcquisitions ?? []).some((item) => !item.refunded_at);
  const completedHere = query.completed === "1" && Boolean(query.sale);

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href={`/admin/alumnas/${student.id}`}>
            ← Perfil 360
          </Link>
          <p className="eyebrow">ALTA COMPLETA · {studio.name}</p>
          <h1 className="dashboard-title">{student.full_name}</h1>
          <p>
            El expediente ya existe. A partir de aquí Studio Flow conserva a la misma alumna en
            contexto.
          </p>
        </div>
        <span className="role-pill">
          {student.profile_status === "complete" ? "Expediente completo" : "Expediente incompleto"}
        </span>
      </header>

      {query.error ? (
        <div className="notice error">
          {errorCopy[decodeURIComponent(query.error)] ?? "No se pudo completar el alta."}
        </div>
      ) : null}

      {completedHere ? <OnboardingCompletedDialog /> : null}

      {!student.active || student.lifecycle_status !== "active" ? (
        <section className="panel">
          <p className="eyebrow">ESTADO DE LA ALUMNA</p>
          <h2>Primero hay que reactivar el expediente</h2>
          <p>
            No se crearán compras nuevas mientras la alumna esté inactiva o archivada. El expediente
            existente conserva toda su historia.
          </p>
          <Link
            className="primary-button inline-flex"
            href={`/admin/alumnas/${student.id}#estado-alumna`}
          >
            Ir al estado de la alumna
          </Link>
        </section>
      ) : alreadyHasPackage && !completedHere ? (
        <section className="panel">
          <p className="eyebrow">PAQUETE EXISTENTE</p>
          <h2>Esta alumna ya tiene una adquisición activa</h2>
          <p>
            El alta inicial no se usará como atajo para una renovación. Continúa desde Perfil 360
            para conservar las reglas aprobadas de paquetes actuales y programados.
          </p>
          <Link className="primary-button inline-flex" href={`/admin/alumnas/${student.id}`}>
            Volver a Perfil 360
          </Link>
        </section>
      ) : !canSell ? (
        <section className="panel">
          <p className="eyebrow">VENTA OPCIONAL</p>
          <h2>Tu rol no registra ventas</h2>
          <p>El expediente ya fue creado correctamente. Puedes terminar el alta sin paquete.</p>
          <Link
            className="primary-button inline-flex"
            href={`/admin/alumnas/${student.id}?alta=sin_paquete`}
          >
            Terminar alta
          </Link>
        </section>
      ) : (
        <StudentOnboardingForm
          studentId={student.id}
          studentName={student.full_name}
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
          completedSaleId={completedHere ? (query.sale ?? null) : null}
        />
      )}
    </main>
  );
}
