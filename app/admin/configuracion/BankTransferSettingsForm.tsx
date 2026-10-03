"use client";

import { useFormStatus } from "react-dom";

import { saveStudioBankTransferSettingsAction } from "./actions";

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
  return (
    <form action={saveStudioBankTransferSettingsAction} className="advanced-v2-form">
      <label className="advanced-v2-field">
        <span>Transferencia bancaria</span>
        <select name="enabled" defaultValue={enabled ? "1" : "0"}>
          <option value="1">Activa</option>
          <option value="0">Desactivada</option>
        </select>
        <small>Demi solo compartirá estos datos cuando la transferencia esté activa.</small>
      </label>

      <label className="advanced-v2-field">
        <span>Banco</span>
        <input name="bank_name" defaultValue={bankName} maxLength={80} autoComplete="off" />
      </label>

      <label className="advanced-v2-field">
        <span>Titular de la cuenta</span>
        <input name="account_holder" defaultValue={accountHolder} maxLength={120} autoComplete="off" />
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
