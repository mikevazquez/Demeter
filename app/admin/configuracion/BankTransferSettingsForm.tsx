"use client";

import type { FormEvent, InvalidEvent } from "react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { saveStudioBankTransferSettingsAction } from "./actions";

function normalizeDigits(
  event: FormEvent<HTMLInputElement>,
  maxLength: number,
) {
  const input = event.currentTarget;
  input.value = input.value.replace(/\D/g, "").slice(0, maxLength);
  input.setCustomValidity("");
}

function requireExactDigits(
  event: InvalidEvent<HTMLInputElement>,
  label: string,
  digits: number,
) {
  const input = event.currentTarget;
  const actual = input.value.replace(/\D/g, "").length;
  input.setCustomValidity(
    actual
      ? `${label} debe tener ${digits} dígitos. Actualmente tiene ${actual}.`
      : `${label} debe tener ${digits} dígitos.`,
  );
}

function requireDigitRange(
  event: InvalidEvent<HTMLInputElement>,
  label: string,
  min: number,
  max: number,
) {
  const input = event.currentTarget;
  const actual = input.value.replace(/\D/g, "").length;
  input.setCustomValidity(
    `${label} debe tener entre ${min} y ${max} dígitos. Actualmente tiene ${actual}.`,
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="advanced-v2-save" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Guardando…" : "Guardar cambios"}
    </button>
  );
}

export function BankTransferSettingsForm({
  enabled,
  bankName,
  accountHolder,
  clabe,
  accountNumber,
  cardNumber,
  instructions,
}: {
  enabled: boolean;
  bankName: string;
  accountHolder: string;
  clabe: string;
  accountNumber: string;
  cardNumber: string;
  instructions: string;
}) {
  const [transferEnabled, setTransferEnabled] = useState(enabled);

  function validateBeforeSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const data = new FormData(form);

    if (!transferEnabled) return;

    const clabe = String(data.get("clabe") ?? "").replace(/\D/g, "");
    const account = String(data.get("account_number") ?? "").replace(/\D/g, "");
    const card = String(data.get("card_number") ?? "").replace(/\D/g, "");

    if (!clabe && !account && !card) {
      event.preventDefault();
      const clabeInput = form.elements.namedItem("clabe") as HTMLInputElement | null;
      clabeInput?.setCustomValidity(
        "Captura una CLABE, un número de cuenta o un número de tarjeta para transferencia.",
      );
      clabeInput?.reportValidity();
    }
  }

  return (
    <form
      action={saveStudioBankTransferSettingsAction}
      className="advanced-v2-form"
      onSubmit={validateBeforeSubmit}
    >
      <label className="advanced-v2-field">
        <span>Transferencia bancaria</span>
        <select
          name="enabled"
          defaultValue={enabled ? "1" : "0"}
          onChange={(event) => setTransferEnabled(event.currentTarget.value === "1")}
        >
          <option value="1">Activa</option>
          <option value="0">Desactivada</option>
        </select>
        <small>Demi solo compartirá estos datos cuando la transferencia esté activa.</small>
      </label>

      <label className="advanced-v2-field">
        <span>Banco</span>
        <input
          name="bank_name"
          defaultValue={bankName}
          maxLength={80}
          autoComplete="off"
          required={transferEnabled}
        />
      </label>

      <label className="advanced-v2-field">
        <span>Titular de la cuenta</span>
        <input
          name="account_holder"
          defaultValue={accountHolder}
          maxLength={120}
          autoComplete="off"
          required={transferEnabled}
        />
      </label>

      <label className="advanced-v2-field">
        <span>CLABE</span>
        <input
          name="clabe"
          defaultValue={clabe}
          inputMode="numeric"
          pattern="[0-9]{18}"
          maxLength={18}
          autoComplete="off"
          onInput={(event) => normalizeDigits(event, 18)}
          onInvalid={(event) => requireExactDigits(event, "La CLABE", 18)}
        />
        <small>18 dígitos. Demi la compartirá únicamente cuando la alumna elija transferencia.</small>
      </label>

      <label className="advanced-v2-field">
        <span>Número de cuenta (opcional)</span>
        <input
          name="account_number"
          defaultValue={accountNumber}
          inputMode="numeric"
          pattern="[0-9]{4,20}"
          maxLength={20}
          autoComplete="off"
          onInput={(event) => normalizeDigits(event, 20)}
          onInvalid={(event) =>
            requireDigitRange(event, "El número de cuenta", 4, 20)
          }
        />
      </label>

      <label className="advanced-v2-field">
        <span>Número de tarjeta para transferencia (opcional)</span>
        <input
          name="card_number"
          defaultValue={cardNumber}
          inputMode="numeric"
          pattern="[0-9]{12,19}"
          maxLength={19}
          autoComplete="off"
          onInput={(event) => normalizeDigits(event, 19)}
          onInvalid={(event) =>
            requireDigitRange(event, "El número de tarjeta", 12, 19)
          }
        />
      </label>

      <label className="advanced-v2-field">
        <span>Indicaciones adicionales (opcional)</span>
        <textarea
          name="instructions"
          defaultValue={instructions}
          maxLength={300}
          rows={3}
          placeholder="Ej. Usa tu nombre como concepto."
        />
      </label>

      <SubmitButton />
    </form>
  );
}
