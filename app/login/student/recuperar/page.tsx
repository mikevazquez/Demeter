import type { Metadata } from "next";

import { RecoveryRequestFlow } from "../../recovery-client";
import { RecoveryShell } from "../../recovery-ui";

export const metadata: Metadata = { title: "Recupera tu acceso · Demeter" };

export default function StudentRecoveryPage() {
  return (
    <RecoveryShell backHref="/login/student">
      <RecoveryRequestFlow portal="student" />
    </RecoveryShell>
  );
}
