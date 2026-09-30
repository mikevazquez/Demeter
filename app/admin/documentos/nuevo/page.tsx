import Link from "next/link";
import "../documents-v2.css";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { createDocumentAction } from "../actions";

export default async function NewDocumentPage() {
  await getAdminContext(CAPABILITIES.DOCUMENTS_MANAGE);

  return (
    <main className="dashboard-shell documents-v2 documents-new-v2 mx-auto max-w-3xl space-y-5">
      <Link
        href="/admin/documentos"
        className="documents-back text-sm font-semibold"
      >
        ← Documentos
      </Link>
      <header>
        <p className="eyebrow">DOCUMENTOS · NUEVO</p>
        <h1 className="dashboard-title">Nuevo documento</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Primero crea el borrador. Después podrás cargar el PDF y definir a quién aplica.
        </p>
      </header>

      <form
        action={createDocumentAction}
        className="documents-new-card space-y-5 rounded-3xl p-6"
      >
        <label className="block">
          <span className="mb-2 block text-sm font-semibold">Nombre del documento</span>
          <input
            name="name"
            required
            maxLength={120}
            placeholder="Ej. Responsiva general"
            className="documents-field w-full rounded-2xl px-4 py-3 text-sm outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold">Tipo</span>
          <select
            name="document_type"
            defaultValue="waiver"
            className="documents-field w-full rounded-2xl px-4 py-3 text-sm"
          >
            <option value="waiver">Responsiva</option>
            <option value="regulation">Reglamento</option>
            <option value="contract">Contrato</option>
            <option value="privacy">Aviso de privacidad</option>
            <option value="consent">Consentimiento</option>
            <option value="notice">Aviso</option>
            <option value="other">Otro</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold">Descripción interna</span>
          <textarea
            name="description"
            rows={4}
            maxLength={500}
            placeholder="Explica brevemente para qué se usa."
            className="documents-field w-full rounded-2xl px-4 py-3 text-sm outline-none"
          />
        </label>

        <div className="documents-new-note rounded-2xl p-4 text-sm leading-6">
          Crear este borrador no afecta a ninguna alumna ni bloquea reservas.
        </div>

        <button className="documents-primary-action w-full px-5 py-3 text-sm font-semibold">
          Crear borrador y continuar
        </button>
      </form>
    </main>
  );
}
