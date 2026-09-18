"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { createStudentOnboardingSale } from "./actions";

type PackageOption = {
  id: string;
  name: string;
  packageTerm: string | null;
  priceMinor: number;
  currency: string;
  creditLimit: number | null;
  validityDays: number | null;
  unlimited: boolean;
};

type EnrollmentProduct = {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  validityDays: number | null;
};

const termCopy: Record<string, string> = {
  monthly: "Mensual",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
  custom: "Otra vigencia",
};

function money(minor: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

function inputMoneyToMinor(value: string) {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0;
}

export default function StudentOnboardingForm({
  studentId,
  studentName,
  packages,
  today,
  idempotencyKey,
  enrollmentRequired,
  currentEnrollment,
  enrollmentProducts,
  defaultEnrollmentProductId,
}: {
  studentId: string;
  studentName: string;
  packages: PackageOption[];
  today: string;
  idempotencyKey: string;
  enrollmentRequired: boolean;
  currentEnrollment: boolean;
  enrollmentProducts: EnrollmentProduct[];
  defaultEnrollmentProductId: string | null;
}) {
  const [selectedId, setSelectedId] = useState(packages[0]?.id ?? "");
  const [startMode, setStartMode] = useState("today");
  const [discountMode, setDiscountMode] = useState("none");
  const [discountValue, setDiscountValue] = useState("");
  const [enrollmentResolution, setEnrollmentResolution] = useState(
    currentEnrollment ? "already_active" : enrollmentRequired ? "paid" : "not_required",
  );
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState(
    defaultEnrollmentProductId &&
      enrollmentProducts.some((item) => item.id === defaultEnrollmentProductId)
      ? defaultEnrollmentProductId
      : (enrollmentProducts[0]?.id ?? ""),
  );
  const [paymentAmount, setPaymentAmount] = useState("");
  const [priorCredits, setPriorCredits] = useState("0");

  const selectedPackage = useMemo(
    () => packages.find((item) => item.id === selectedId) ?? packages[0] ?? null,
    [packages, selectedId],
  );

  const selectedEnrollment = useMemo(
    () =>
      enrollmentProducts.find((item) => item.id === selectedEnrollmentId) ??
      enrollmentProducts[0] ??
      null,
    [enrollmentProducts, selectedEnrollmentId],
  );

  const packageDiscountMinor = useMemo(() => {
    if (!selectedPackage) return 0;
    if (discountMode === "courtesy") return selectedPackage.priceMinor;
    if (discountMode === "percentage") {
      const percentage = Number(discountValue);
      if (!Number.isFinite(percentage) || percentage <= 0) return 0;
      return Math.min(
        selectedPackage.priceMinor,
        Math.round((selectedPackage.priceMinor * percentage) / 100),
      );
    }
    if (discountMode === "amount") {
      return Math.min(selectedPackage.priceMinor, inputMoneyToMinor(discountValue));
    }
    return 0;
  }, [discountMode, discountValue, selectedPackage]);

  const enrollmentNetMinor =
    enrollmentRequired &&
    !currentEnrollment &&
    enrollmentResolution === "paid" &&
    selectedEnrollment
      ? selectedEnrollment.priceMinor
      : 0;

  const packageNetMinor = selectedPackage
    ? Math.max(selectedPackage.priceMinor - packageDiscountMinor, 0)
    : 0;
  const totalMinor = packageNetMinor + enrollmentNetMinor;
  const paidMinor = Math.min(inputMoneyToMinor(paymentAmount), totalMinor);
  const balanceMinor = Math.max(totalMinor - paidMinor, 0);
  const pendingWithoutPayment = totalMinor > 0 && paidMinor === 0;

  if (!selectedPackage) {
    return (
      <section className="panel">
        <p className="eyebrow">PAQUETE</p>
        <h2>No hay paquetes disponibles</h2>
        <p>El expediente ya fue creado. Puedes terminar el alta sin una compra.</p>
        <Link
          className="primary-button inline-flex"
          href={`/admin/alumnas/${studentId}?alta=sin_paquete`}
        >
          Terminar alta
        </Link>
      </section>
    );
  }

  return (
    <form action={createStudentOnboardingSale} className="grid gap-5">
      <input type="hidden" name="student_id" value={studentId} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <input type="hidden" name="package_product_id" value={selectedPackage.id} />
      <input type="hidden" name="package_start_mode" value={startMode} />
      <input type="hidden" name="enrollment_resolution" value={enrollmentResolution} />
      <input
        type="hidden"
        name="enrollment_product_id"
        value={selectedEnrollment?.id ?? ""}
      />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">1 · PAQUETE</p>
            <h2>¿Qué adquiere {studentName}?</h2>
            <p>Precio, créditos y vigencia salen del producto. Aquí sólo eliges el producto.</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {packages.map((item) => {
            const selected = item.id === selectedPackage.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`rounded-2xl border p-4 text-left transition ${
                  selected
                    ? "border-fuchsia-500/70 bg-fuchsia-500/10"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
                      {item.packageTerm
                        ? (termCopy[item.packageTerm] ?? "Otra vigencia")
                        : "Paquete"}
                    </p>
                    <strong className="mt-1 block text-white">{item.name}</strong>
                    <span className="mt-1 block text-sm text-zinc-400">
                      {item.unlimited ? "Clases ilimitadas" : `${item.creditLimit ?? 0} créditos`}
                      {item.validityDays ? ` · ${item.validityDays} días` : ""}
                    </span>
                  </div>
                  <strong>{money(item.priceMinor, item.currency)}</strong>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">2 · INICIO DE VIGENCIA</p>
        <h2>¿Cuándo empieza?</h2>
        <div className="compact-form">
          <label>
            <span>Inicio del paquete</span>
            <select value={startMode} onChange={(event) => setStartMode(event.target.value)}>
              <option value="today">Hoy</option>
              <option value="specific">Fecha específica</option>
              <option value="first_attendance">Primera asistencia</option>
            </select>
          </label>

          {startMode === "specific" ? (
            <label>
              <span>Fecha de inicio</span>
              <input name="package_starts_on" type="date" required defaultValue={today} />
            </label>
          ) : (
            <input type="hidden" name="package_starts_on" value="" />
          )}

          {startMode === "first_attendance" ? (
            <div className="notice">
              Reservar una clase no iniciará la vigencia. El paquete comenzará cuando la alumna
              registre su primera asistencia.
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">3 · AJUSTES COMERCIALES</p>
        <h2>Descuento o cortesía</h2>
        <div className="compact-form">
          <label>
            <span>Ajuste</span>
            <select
              value={discountMode}
              name="discount_mode"
              onChange={(event) => setDiscountMode(event.target.value)}
            >
              <option value="none">Sin descuento</option>
              <option value="percentage">Descuento por porcentaje</option>
              <option value="amount">Descuento por monto</option>
              <option value="courtesy">Cortesía total</option>
            </select>
          </label>

          {discountMode === "percentage" ? (
            <label>
              <span>Porcentaje</span>
              <input
                name="discount_value"
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                required
                value={discountValue}
                onChange={(event) => setDiscountValue(event.target.value)}
              />
            </label>
          ) : discountMode === "amount" ? (
            <label>
              <span>Monto a descontar</span>
              <input
                name="discount_value"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={discountValue}
                onChange={(event) => setDiscountValue(event.target.value)}
              />
            </label>
          ) : (
            <input type="hidden" name="discount_value" value="" />
          )}

          {discountMode !== "none" ? (
            <label>
              <span>Motivo</span>
              <input
                name="discount_reason"
                required
                maxLength={500}
                placeholder="Ej. promoción autorizada"
              />
            </label>
          ) : (
            <input type="hidden" name="discount_reason" value="" />
          )}
        </div>
      </section>

      {enrollmentRequired ? (
        <section className="panel">
          <p className="eyebrow">4 · INSCRIPCIÓN</p>
          <h2>Resolver requisito del estudio</h2>
          {currentEnrollment ? (
            <>
              <div className="notice success">
                La alumna ya tiene una inscripción vigente. No se volverá a cobrar ni crear otra.
              </div>
              <input type="hidden" name="enrollment_effective_on" value="" />
              <input type="hidden" name="enrollment_reason" value="" />
            </>
          ) : selectedEnrollment ? (
            <div className="compact-form">
              <label>
                <span>Vigencia de inscripción</span>
                <select
                  value={selectedEnrollment.id}
                  onChange={(event) => setSelectedEnrollmentId(event.target.value)}
                >
                  {enrollmentProducts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ·{" "}
                      {item.validityDays === null ? "Vitalicia" : `${item.validityDays} días`} ·{" "}
                      {money(item.priceMinor, item.currency)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Resolución</span>
                <select
                  value={enrollmentResolution}
                  onChange={(event) => setEnrollmentResolution(event.target.value)}
                >
                  <option value="paid">
                    Cobrar inscripción ·{" "}
                    {money(selectedEnrollment.priceMinor, selectedEnrollment.currency)}
                  </option>
                  <option value="promotion">Aplicar promoción</option>
                  <option value="exception">Aplicar excepción autorizada</option>
                </select>
              </label>
              <label>
                <span>Fecha efectiva</span>
                <input
                  name="enrollment_effective_on"
                  type="date"
                  max={today}
                  required
                  defaultValue={today}
                />
              </label>
              {enrollmentResolution === "promotion" || enrollmentResolution === "exception" ? (
                <label>
                  <span>Motivo</span>
                  <input
                    name="enrollment_reason"
                    maxLength={500}
                    required
                    placeholder="Describe la promoción o excepción"
                  />
                </label>
              ) : (
                <input type="hidden" name="enrollment_reason" value="" />
              )}
            </div>
          ) : (
            <div className="notice error">
              La política exige inscripción, pero no hay productos de inscripción activos.
              Configura al menos una vigencia antes de completar la venta.
            </div>
          )}
        </section>
      ) : (
        <>
          <input type="hidden" name="enrollment_effective_on" value="" />
          <input type="hidden" name="enrollment_reason" value="" />
        </>
      )}

      <section className="panel">
        <p className="eyebrow">5 · HISTORIAL INICIAL</p>
        <h2>¿Ya consumió clases de este paquete?</h2>
        <p>
          Si aplica, Studio Flow conserva la adquisición y registra un ajuste auditable de créditos;
          no inventa asistencias.
        </p>
        <div className="compact-form">
          <label>
            <span>Créditos ya consumidos</span>
            <input
              name="prior_credits_used"
              type="number"
              min="0"
              step="1"
              value={priorCredits}
              onChange={(event) => setPriorCredits(event.target.value)}
            />
          </label>
          {Number(priorCredits) > 0 ? (
            <label>
              <span>Motivo del ajuste</span>
              <input
                name="prior_credits_reason"
                required
                maxLength={500}
                placeholder="Ej. clases tomadas antes de registrar el expediente"
              />
            </label>
          ) : (
            <input type="hidden" name="prior_credits_reason" value="" />
          )}
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">6 · PAGO</p>
        <h2>Registrar lo que ocurrió</h2>
        <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <div className="compact-form">
            <label>
              <span>Monto recibido</span>
              <input
                name="payment_amount"
                type="number"
                min="0"
                step="0.01"
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(event.target.value)}
                placeholder="0.00"
              />
            </label>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setPaymentAmount((totalMinor / 100).toFixed(2))}
            >
              Usar total · {money(totalMinor, selectedPackage.currency)}
            </button>

            {paidMinor > 0 ? (
              <>
                <label>
                  <span>Método de pago</span>
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
                  <span>Fecha real del pago</span>
                  <input
                    name="payment_effective_on"
                    type="date"
                    max={today}
                    required
                    defaultValue={today}
                  />
                </label>
                <label>
                  <span>Referencia opcional</span>
                  <input name="payment_reference" maxLength={120} />
                </label>
                <label>
                  <span>Nota opcional</span>
                  <textarea name="payment_notes" rows={2} maxLength={500} />
                </label>
              </>
            ) : (
              <>
                <input type="hidden" name="payment_method" value="" />
                <input type="hidden" name="payment_effective_on" value="" />
                <input type="hidden" name="payment_reference" value="" />
                <input type="hidden" name="payment_notes" value="" />
              </>
            )}

            {balanceMinor > 0 ? (
              <>
                <label>
                  <span>Fecha compromiso de pago</span>
                  <input name="payment_due_on" type="date" min={today} />
                </label>
                <label>
                  <span>Seguimiento de cobranza</span>
                  <input
                    name="collection_note"
                    maxLength={500}
                    placeholder="Si no hay fecha, deja una instrucción de seguimiento"
                  />
                </label>
              </>
            ) : (
              <>
                <input type="hidden" name="payment_due_on" value="" />
                <input type="hidden" name="collection_note" value="" />
              </>
            )}

            {pendingWithoutPayment ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
                <label className="checkbox-field">
                  <input name="allow_pending_access" type="checkbox" />
                  <span>Autorizar uso del paquete aunque todavía no haya pago</span>
                </label>
                <label className="mt-3 grid gap-1">
                  <span className="text-sm text-zinc-300">Motivo de la excepción</span>
                  <input
                    name="pending_access_reason"
                    maxLength={500}
                    placeholder="Obligatorio sólo si autorizas la excepción"
                  />
                </label>
              </div>
            ) : (
              <>
                <input type="hidden" name="pending_access_reason" value="" />
              </>
            )}
          </div>

          <aside className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="eyebrow">RESUMEN</p>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-zinc-400">Precio de lista</span>
                <strong>{money(selectedPackage.priceMinor, selectedPackage.currency)}</strong>
              </div>
              {packageDiscountMinor > 0 ? (
                <div className="flex justify-between gap-3">
                  <span className="text-zinc-400">Descuento</span>
                  <strong>− {money(packageDiscountMinor, selectedPackage.currency)}</strong>
                </div>
              ) : null}
              {enrollmentNetMinor > 0 ? (
                <div className="flex justify-between gap-3">
                  <span className="text-zinc-400">Inscripción</span>
                  <strong>{money(enrollmentNetMinor, selectedPackage.currency)}</strong>
                </div>
              ) : null}
              <div className="border-t border-white/10 pt-3 flex justify-between gap-3 text-base">
                <span>Total</span>
                <strong>{money(totalMinor, selectedPackage.currency)}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-400">Registrado ahora</span>
                <strong>{money(paidMinor, selectedPackage.currency)}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-400">Saldo pendiente</span>
                <strong>{money(balanceMinor, selectedPackage.currency)}</strong>
              </div>
            </div>
            {pendingWithoutPayment ? (
              <p className="mt-4 text-sm text-amber-200">
                Sin pago, el paquete queda bloqueado para reservar salvo que autorices
                explícitamente la excepción.
              </p>
            ) : null}
          </aside>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">7 · CONFIRMAR</p>
        <h2>Completar alta</h2>
        <p>
          Se registrará una sola venta y una sola adquisición. Una doble pulsación reutiliza la
          misma operación.
        </p>
        <div className="toolbar-actions mt-4">
          <button
            className="primary-button"
            type="submit"
            disabled={enrollmentRequired && !currentEnrollment && enrollmentProducts.length === 0}
          >
            Completar alta
          </button>
          <Link className="ghost-button" href={`/admin/alumnas/${studentId}?alta=sin_paquete`}>
            Terminar sin paquete
          </Link>
        </div>
      </section>
    </form>
  );
}
