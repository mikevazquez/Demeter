import type { Metadata } from "next";

import {
  completeStudentRecoveryAction,
  retryStudentRecoveryPasswordAction,
} from "../../../recovery-actions";
import { NewPasswordFields } from "../../../recovery-client";
import { ExpiredLink, RecoveryPath, RecoveryShell } from "../../../recovery-ui";

export const metadata: Metadata = { title: "Crea tu nueva contraseña · Demeter" };

const messages: Record<string, string> = {
  weak: "Usa al menos 8 caracteres con letras y números.",
  mismatch: "Las dos contraseñas no coinciden.",
  password: "No se pudo guardar la contraseña. Intenta con otra.",
};

export default async function StudentNewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; error?: string; session?: string }>;
}) {
  const { token_hash: tokenHash, error, session } = await searchParams;
  const retryWithSession = session === "1";
  const token = typeof tokenHash === "string" && tokenHash.trim() ? tokenHash.trim() : null;

  if (error === "link" || (!token && !retryWithSession)) {
    return (
      <RecoveryShell>
        <ExpiredLink retryHref="/login/student/recuperar" loginHref="/login/student" />
      </RecoveryShell>
    );
  }

  return (
    <RecoveryShell>
      <RecoveryPath step={3} />
      <div className="srec-intro">
        <h1 className="srec-title">Crea tu nueva contraseña</h1>
        <p className="srec-copy">Úsala para entrar al portal desde cualquier dispositivo.</p>
      </div>
      {error && messages[error] ? (
        <div className="srec-error" role="alert">
          {messages[error]}
        </div>
      ) : null}
      <form
        className="srec-form"
        action={
          retryWithSession ? retryStudentRecoveryPasswordAction : completeStudentRecoveryAction
        }
      >
        {token ? <input type="hidden" name="token_hash" value={token} /> : null}
        <NewPasswordFields />
      </form>
      <p className="srec-small" style={{ marginTop: "auto" }}>
        Al guardar se cierran las sesiones abiertas en otros dispositivos.
      </p>
    </RecoveryShell>
  );
}
