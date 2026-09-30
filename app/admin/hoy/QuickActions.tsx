"use client";

import { useMemo, useState, useTransition } from "react";
import { createQuickSale, createQuickStudent } from "./quick-actions";

type Student = { id: string; fullName: string };
type Product = {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  creditLimit: number | null;
  validityDays: number | null;
  unlimited: boolean;
};

type Props = {
  canStudents: boolean;
  canSales: boolean;
  students: Student[];
  products: Product[];
  locale: string;
  preferredProductByStudent?: Record<string, string>;
};

function money(value: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export default function QuickActions({
  canStudents,
  canSales,
  students,
  products,
  locale,
  preferredProductByStudent = {},
}: Props) {
  const [open, setOpen] = useState<null | "menu" | "student" | "studentCreated" | "sale">(null);
  const [studentQuery, setStudentQuery] = useState("");
  const [studentId, setStudentId] = useState("");
  const [productId, setProductId] = useState("");
  const [showOtherProducts, setShowOtherProducts] = useState(false);
  const [discountMode, setDiscountMode] = useState("none");
  const [discountValue, setDiscountValue] = useState("");
  const [payment, setPayment] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [createdStudent, setCreatedStudent] = useState<Student | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedProduct = products.find((item) => item.id === productId) ?? null;
  const preferredId = studentId ? preferredProductByStudent[studentId] : undefined;

  const studentMatches = useMemo(() => {
    const query = studentQuery.trim().toLocaleLowerCase("es");
    if (!query || studentId) return [];
    return students
      .filter((student) => student.fullName.toLocaleLowerCase("es").includes(query))
      .slice(0, 7);
  }, [studentId, studentQuery, students]);

  const visibleProducts = useMemo(() => {
    if (!studentId) return [];
    const preferred = products.find((item) => item.id === preferredId);
    const monthly = products.filter(
      (item) =>
        item.id !== preferredId &&
        item.validityDays !== null &&
        item.validityDays >= 28 &&
        item.validityDays <= 31,
    );
    return preferred ? [preferred, ...monthly] : monthly;
  }, [preferredId, products, studentId]);

  const otherProducts = useMemo(
    () => products.filter((item) => !visibleProducts.some((visible) => visible.id === item.id)),
    [products, visibleProducts],
  );

  const discountMinor = useMemo(() => {
    if (!selectedProduct) return 0;
    if (discountMode === "courtesy") return selectedProduct.priceMinor;
    if (discountMode === "percentage") {
      const percentage = Number(discountValue) || 0;
      return Math.min(selectedProduct.priceMinor, Math.round(selectedProduct.priceMinor * percentage / 100));
    }
    if (discountMode === "amount") {
      return Math.min(selectedProduct.priceMinor, Math.round((Number(discountValue) || 0) * 100));
    }
    return 0;
  }, [discountMode, discountValue, selectedProduct]);

  const totalMinor = selectedProduct
    ? Math.max(selectedProduct.priceMinor - discountMinor, 0)
    : 0;

  function close() {
    setOpen(null);
    setMessage(null);
  }

  function chooseStudent(student: Student) {
    setStudentId(student.id);
    setStudentQuery(student.fullName);
    setProductId("");
    setShowOtherProducts(false);
    setPayment("");
  }

  function renderProduct(product: Product) {
    return (
      <button
        key={product.id}
        type="button"
        className={productId === product.id ? "is-selected" : ""}
        onClick={() => {
          setProductId(product.id);
          setPayment("");
        }}
      >
        <strong>{product.name}</strong>
        <small>
          {product.unlimited ? "Ilimitado" : `${product.creditLimit ?? 0} créditos`}
          {product.validityDays ? ` · ${product.validityDays} días` : ""}
        </small>
        {product.id === preferredId ? <em>Habitual</em> : null}
      </button>
    );
  }

  return (
    <div className="hoy-quick-root">
      <button
        className="hoy-header-action"
        type="button"
        onClick={() => setOpen(open ? null : "menu")}
      >
        Atajos
      </button>

      {open === "menu" ? (
        <div className="hoy-shortcuts-menu hoy-shortcuts-menu-inline">
          {canStudents ? (
            <button type="button" onClick={() => { setMessage(null); setOpen("student"); }}>
              Nueva alumna
            </button>
          ) : null}
          {canSales ? (
            <button type="button" onClick={() => { setMessage(null); setOpen("sale"); }}>
              Nueva venta
            </button>
          ) : null}
        </div>
      ) : null}

      {open === "student" ? (
        <div className="hoy-quick-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="hoy-quick-card">
            <header>
              <div>
                <span>Atajo</span>
                <h2>Nueva alumna</h2>
                <p>Nombre y teléfono bastan para crearla.</p>
              </div>
              <button type="button" onClick={close}>×</button>
            </header>
            <form
              className="hoy-quick-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                startTransition(async () => {
                  const result = await createQuickStudent(data);
                  setMessage({ ok: result.ok, text: result.message });
                  if (result.ok && result.student) {
                    form.reset();
                    setCreatedStudent(result.student);
                    setMessage(null);
                    setOpen("studentCreated");
                  }
                });
              }}
            >
              <input name="first_name" placeholder="Nombre" required />
              <input name="last_name" placeholder="Apellido opcional" />
              <input name="phone" inputMode="tel" placeholder="Teléfono · 10 dígitos" required />
              <input name="email" type="email" placeholder="Correo opcional" />
              {message ? <p className={message.ok ? "quick-success" : "quick-error"}>{message.text}</p> : null}
              <button className="primary-button" disabled={pending}>
                {pending ? "Creando…" : "Crear alumna"}
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {open === "studentCreated" && createdStudent ? (
        <div className="hoy-quick-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="hoy-quick-card">
            <header>
              <div>
                <span>Alumna creada</span>
                <h2>{createdStudent.fullName}</h2>
                <p>¿Quieres agregarle un paquete de clases ahora?</p>
              </div>
              <button type="button" onClick={close}>×</button>
            </header>
            <div className="hoy-quick-form">
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  chooseStudent(createdStudent);
                  setMessage(null);
                  setOpen("sale");
                }}
              >
                Sí, agregar paquete
              </button>
              <button className="secondary-button" type="button" onClick={close}>
                No, terminar
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {open === "sale" ? (
        <div className="hoy-quick-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="hoy-quick-card hoy-quick-sale">
            <header>
              <div>
                <span>Atajo</span>
                <h2>Nueva venta</h2>
                <p>Busca a la alumna y elige su paquete.</p>
              </div>
              <button type="button" onClick={close}>×</button>
            </header>

            <form
              className="hoy-quick-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                startTransition(async () => {
                  const result = await createQuickSale(data);
                  setMessage({ ok: result.ok, text: result.message });
                  if (result.ok) window.setTimeout(close, 850);
                });
              }}
            >
              <label className="hoy-student-search">
                <span>Alumna</span>
                <input
                  autoComplete="off"
                  placeholder="Escribe el nombre…"
                  value={studentQuery}
                  onChange={(event) => {
                    setStudentQuery(event.target.value);
                    setStudentId("");
                    setProductId("");
                  }}
                />
                {studentMatches.length > 0 ? (
                  <div className="hoy-student-results">
                    {studentMatches.map((student) => (
                      <button type="button" key={student.id} onClick={() => chooseStudent(student)}>
                        {student.fullName}
                      </button>
                    ))}
                  </div>
                ) : null}
                <input type="hidden" name="student_id" value={studentId} />
              </label>

              {studentId && !selectedProduct ? (
                <div className="hoy-package-picker">
                  <span>Paquete</span>
                  <div className="hoy-package-options">
                    {visibleProducts.map(renderProduct)}
                  </div>
                  {otherProducts.length > 0 ? (
                    <button
                      type="button"
                      className="hoy-other-products"
                      onClick={() => setShowOtherProducts((value) => !value)}
                    >
                      {showOtherProducts ? "Ocultar otros paquetes" : "Ver otros paquetes"}
                    </button>
                  ) : null}
                  {showOtherProducts ? (
                    <div className="hoy-package-options hoy-package-options-other">
                      {otherProducts.map(renderProduct)}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <input type="hidden" name="product_id" value={productId} />

              {selectedProduct ? (
                <>
                  <div className="hoy-quick-product">
                    <div>
                      <strong>{selectedProduct.name}</strong>
                      <button type="button" className="hoy-change-package" onClick={() => { setProductId(""); setPayment(""); }}>
                        Cambiar paquete
                      </button>
                    </div>
                    <span>
                      {selectedProduct.unlimited ? "Ilimitado" : `${selectedProduct.creditLimit ?? 0} créditos`}
                      {selectedProduct.validityDays ? ` · ${selectedProduct.validityDays} días` : ""}
                    </span>
                    <b>{money(selectedProduct.priceMinor, selectedProduct.currency, locale)}</b>
                  </div>

                  <label>
                    <span>Descuento</span>
                    <select
                      name="discount_mode"
                      value={discountMode}
                      onChange={(event) => {
                        setDiscountMode(event.target.value);
                        setDiscountValue("");
                      }}
                    >
                      <option value="none">Sin descuento</option>
                      <option value="percentage">Porcentaje</option>
                      <option value="amount">Monto</option>
                      <option value="courtesy">Cortesía total</option>
                    </select>
                  </label>

                  {discountMode === "percentage" || discountMode === "amount" ? (
                    <label>
                      <span>{discountMode === "percentage" ? "Porcentaje" : "Monto a descontar"}</span>
                      <input
                        name="discount_value"
                        type="number"
                        min="0"
                        step="0.01"
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
                      <input name="discount_reason" required placeholder="Ej. promoción" />
                    </label>
                  ) : (
                    <input type="hidden" name="discount_reason" value="" />
                  )}

                  <div className="hoy-quick-total">
                    <span>Total</span>
                    <strong>{money(totalMinor, selectedProduct.currency, locale)}</strong>
                  </div>

                  <label>
                    <span>Pago recibido</span>
                    <div className="hoy-money-row">
                      <input
                        name="payment_amount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={payment}
                        onChange={(event) => setPayment(event.target.value)}
                        placeholder="0.00"
                      />
                      <button type="button" onClick={() => setPayment((totalMinor / 100).toFixed(2))}>
                        Usar total
                      </button>
                    </div>
                  </label>

                  {Number(payment) > 0 ? (
                    <label>
                      <span>Cómo pagó</span>
                      <select name="payment_method" required defaultValue="">
                        <option value="" disabled>Seleccionar</option>
                        <option value="Efectivo">Efectivo</option>
                        <option value="Transferencia">Transferencia</option>
                        <option value="Tarjeta">Tarjeta</option>
                        <option value="Otro">Otro</option>
                      </select>
                    </label>
                  ) : (
                    <input type="hidden" name="payment_method" value="" />
                  )}
                </>
              ) : null}

              {message ? <p className={message.ok ? "quick-success" : "quick-error"}>{message.text}</p> : null}
              <button className="primary-button" disabled={pending || !studentId || !productId}>
                {pending ? "Registrando…" : "Registrar venta"}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}