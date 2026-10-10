"use client";

import { useState } from "react";

export function VerifyTokenCopy({ token }: { token: string }) {
  const [visible, setVisible] = useState(false);
  const [feedback, setFeedback] = useState("");
  return (
    <div className="integration-detail-v2-field">
      <span>Verify token</span>
      <input type={visible ? "text" : "password"} value={token} readOnly aria-label="Verify token" onFocus={(event) => event.currentTarget.select()} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="integration-detail-v2-button" onClick={async () => {
          try { await navigator.clipboard.writeText(token); setFeedback("Copiado. Pégalo en Meta."); }
          catch { setVisible(true); setFeedback("Selecciona el texto y usa Copiar."); }
        }}>Copiar token</button>
        <button type="button" className="integration-detail-v2-button" onClick={() => setVisible(!visible)}>{visible ? "Ocultar" : "Mostrar"}</button>
      </div>
      {feedback ? <small role="status">{feedback}</small> : null}
    </div>
  );
}
