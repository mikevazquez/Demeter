import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { assertDemiUatEnvironment } from "@/lib/assistant/uat-environment";
import Bank from "./Bank";
import { listDemiUatRuns } from "./actions";
import "./uat.css";

export const maxDuration = 300;
export default async function DemiUatPage() {
  await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  try {
    assertDemiUatEnvironment(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.VERCEL_ENV);
  } catch {
    return (
      <main>
        <h1>Banco UAT disponible únicamente en Sandbox</h1>
        <Link href="/admin/mas/demi">Volver a Demi</Link>
      </main>
    );
  }
  return (
    <main className="uat-bank">
      <Link href="/admin/mas/demi">← Demi 2.0</Link>
      <h1>Banco operativo de Demi</h1>
      <p>
        Conversaciones que recorren el receptor real de WhatsApp y las operaciones reales de Studio
        Flow, con personas ficticias y mensajes capturados.
      </p>
      <Bank
        initialRuns={await listDemiUatRuns()}
        modelReady={Boolean(process.env.OPENAI_API_KEY?.trim())}
      />
    </main>
  );
}
