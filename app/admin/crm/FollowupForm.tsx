"use client";
import { useActionState, useState, type ChangeEvent } from "react";
import { saveFollowup } from "./actions";
import type { CrmContact } from "@/lib/crm/data";
import { stageLabels, stages } from "@/lib/crm/demi-state";
export default function FollowupForm({
  contact,
  canEdit,
}: {
  contact: CrmContact;
  canEdit: boolean;
}) {
  const [result, action, pending] = useActionState(saveFollowup, {});
  const f = contact.followup;
  const [draft, setDraft] = useState(f);
  const change = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setDraft({ ...draft, [e.target.name]: e.target.value });
  return (
    <form action={action} className="crm-followup" key={f.revision}>
      <h2>Seguimiento de Demi</h2>
      <input type="hidden" name="person_id" value={contact.id} />
      <input type="hidden" name="revision" value={f.revision} />
      <fieldset disabled={!canEdit || pending}>
        <div className="crm-form-grid">
          <label>
            Etapa del prospecto
            <select
              name="prospect_stage"
              value={draft.prospect_stage}
              onChange={change}
              disabled={!!contact.reviewReason || contact.state.personType !== "prospect"}
            >
              {stages.prospect
                .filter((s) => s !== "not_qualified")
                .map((s) => (
                  <option key={s} value={s}>
                    {stageLabels[s]}
                  </option>
                ))}
            </select>
          </label>
          {(!!contact.reviewReason || contact.state.personType !== "prospect") && (
            <input type="hidden" name="prospect_stage" value={f.prospect_stage} />
          )}
          <label>
            Calificación
            <select name="qualification" value={draft.qualification} onChange={change}>
              <option value="pending">Pendiente</option>
              <option value="qualified">Apta</option>
              <option value="not_qualified">No apta</option>
            </select>
          </label>
          <label>
            Motivo si no es apta
            <input
              name="qualification_reason"
              value={draft.qualification_reason}
              onChange={change}
              maxLength={1000}
              placeholder="Distancia, horarios incompatibles…"
            />
          </label>
          <label>
            Ubicación
            <input name="location" value={draft.location} onChange={change} maxLength={200} />
          </label>
          <label>
            Interés
            <input name="interest" value={draft.interest} onChange={change} maxLength={300} />
          </label>
          <label>
            Atención humana
            <select name="human_reason" value={draft.human_reason} onChange={change}>
              <option value="">Sin solicitud</option>
              <option value="requested">Solicitada por la persona</option>
              <option value="refund">Reembolso</option>
              <option value="policy_exception">Excepción a políticas</option>
              <option value="complaint">Queja</option>
              <option value="sensitive_topic">Tema sensible</option>
              <option value="persistent_error">Error persistente</option>
            </select>
          </label>
          <label className="crm-wide">
            Resumen para atención humana
            <textarea
              name="human_summary"
              value={draft.human_summary}
              onChange={change}
              maxLength={2000}
            />
          </label>
          <label>
            Próxima acción
            <input name="next_action" value={draft.next_action} onChange={change} maxLength={500} />
          </label>
          <label>
            Fecha de seguimiento
            <input
              type="date"
              name="next_action_on"
              value={draft.next_action_on}
              onChange={change}
            />
          </label>
          <label className="crm-wide">
            Notas
            <textarea name="notes" value={draft.notes} onChange={change} maxLength={6000} />
          </label>
        </div>
        {canEdit && (
          <button className="crm-primary" type="submit">
            {pending ? "Guardando…" : "Guardar seguimiento"}
          </button>
        )}
      </fieldset>
      {result.error && <p role="alert">{result.error}</p>}
      {result.saved && <p role="status">Seguimiento guardado. El cambio quedó en el historial.</p>}
    </form>
  );
}
