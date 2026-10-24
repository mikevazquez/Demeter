import type { Metadata } from "next";
import Link from "next/link";

import { LockDoneIcon, RecoveryPath, RecoveryShell } from "../../../recovery-ui";

export const metadata: Metadata = { title: "Acceso restablecido · Demeter" };

export default function StudioRecoveryDonePage() {
  return (
    <RecoveryShell>
      <RecoveryPath step={4} />
      <div
        className="srec-intro is-center"
        role="status"
        style={{ flex: 1, justifyContent: "center" }}
      >
        <span className="srec-badge">
          <LockDoneIcon />
        </span>
        <h1 className="srec-title">Listo, ya tienes acceso</h1>
        <p className="srec-copy">
          Tu contraseña se guardó. La próxima vez entra con tu correo y esta contraseña.
        </p>
      </div>
      <div className="srec-footer">
        <Link className="srec-primary" href="/login/studio/seleccionar">
          Entrar al estudio
        </Link>
        <p className="srec-small">Ya iniciaste sesión en este dispositivo.</p>
      </div>
    </RecoveryShell>
  );
}
