"use client";

import { useState } from "react";

export function WorkshopPaymentMethodFields({
  methods = ["cash", "bank_transfer"],
  initialMethod = "cash",
  referenceName = "payment_reference",
  referenceMinLength = 3,
  fieldClassName,
  referenceClassName = fieldClassName,
  disabled = false,
}: {
  methods?: ("cash" | "bank_transfer")[];
  initialMethod?: string;
  referenceName?: string;
  referenceMinLength?: number;
  fieldClassName?: string;
  referenceClassName?: string;
  disabled?: boolean;
}) {
  const [method, setMethod] = useState(initialMethod);
  return (
    <>
      <label className={fieldClassName}>
        <span>Método</span>
        <select
          name="payment_method"
          required
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          disabled={disabled}
        >
          <option value="" disabled>
            Selecciona método
          </option>
          {methods.map((option) => (
            <option key={option} value={option}>
              {option === "cash" ? "Efectivo" : "Transferencia"}
            </option>
          ))}
        </select>
      </label>
      {method === "bank_transfer" ? (
        <label className={referenceClassName}>
          <span>Referencia bancaria</span>
          <input
            name={referenceName}
            minLength={referenceMinLength}
            maxLength={200}
            required
            autoComplete="off"
            disabled={disabled}
          />
        </label>
      ) : null}
    </>
  );
}
