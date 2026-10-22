"use client";

import { useEffect, useState } from "react";

import { completeStudioRecoveryAction } from "../../../recovery-actions";
import { NewPasswordFields } from "../../../recovery-client";
import { ExpiredLink, RecoveryPath } from "../../../recovery-ui";
import { parseRecoveryHash } from "@/lib/auth/password-recovery-core";
import { createClient } from "@/lib/supabase/client";

const messages: Record<string, string> = {
  weak: "Usa al menos 8 caracteres con letras y números.",
  mismatch: "Las dos contraseñas no coinciden.",
  password: "No se pudo guardar la contraseña. Intenta con otra.",
};

type Phase = "checking" | "ready" | "expired";

export function StudioRecoverySession({ error }: { error: string | null }) {
  const [phase, setPhase] = useState<Phase>(error === "link" ? "expired" : "checking");

  useEffect(() => {
    if (error === "link") return;
    let cancelled = false;

    async function openSession() {
      const parsed = parseRecoveryHash(window.location.hash);
      // Never leave tokens in the address bar or browser history.
      if (window.location.hash) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }

      const supabase = createClient("admin");
      if (parsed.kind === "session") {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        });
        if (!cancelled) setPhase(sessionError ? "expired" : "ready");
        return;
      }

      if (parsed.kind === "error") {
        if (!cancelled) setPhase("expired");
        return;
      }

      // Returning after a validation error: the recovery session is already stored.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!cancelled) setPhase(session && error ? "ready" : "expired");
    }

    void openSession();
    return () => {
      cancelled = true;
    };
  }, [error]);

  if (phase === "expired") {
    return <ExpiredLink retryHref="/login/studio/recuperar" loginHref="/login/studio" />;
  }

  return (
    <>
      <RecoveryPath step={3} />
      <div className="srec-intro">
        <h1 className="srec-title">Crea tu nueva contraseña</h1>
        <p className="srec-copy">Para tu cuenta de equipo del estudio.</p>
      </div>
      {error && messages[error] ? (
        <div className="srec-error" role="alert">
          {messages[error]}
        </div>
      ) : null}
      {phase === "checking" ? (
        <p className="srec-copy" role="status">
          Validando tu enlace…
        </p>
      ) : (
        <form className="srec-form" action={completeStudioRecoveryAction}>
          <NewPasswordFields />
        </form>
      )}
      <p className="srec-small" style={{ marginTop: "auto" }}>
        Al guardar se cierran las sesiones abiertas en otros dispositivos.
      </p>
    </>
  );
}
