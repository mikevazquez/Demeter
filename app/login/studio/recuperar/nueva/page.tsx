import type { Metadata } from "next";

import { RecoveryShell } from "../../../recovery-ui";
import { StudioRecoverySession } from "./studio-recovery-session";

export const metadata: Metadata = { title: "Crea tu nueva contraseña · Demeter" };

export default async function StudioNewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <RecoveryShell>
      <StudioRecoverySession error={error ?? null} />
    </RecoveryShell>
  );
}
