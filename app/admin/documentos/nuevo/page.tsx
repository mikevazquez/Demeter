import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { createDocumentAction } from "../actions";

export default async function NewDocumentPage() {
  await getAdminContext(CAPABILITIES.DOCUMENTS_MANAGE);

  return (
    <main className="dashboard-shell mx-auto max-w-3xl space-y-5">
      <Link
        href="/admin/documentos"
        className="text-sm font-semibold text-zinc-400 hover:text-white"
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
        className="space-y-5 rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-6"
      >
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-white">Nombre del documento</span>
          <input
            name="name"
            required
            maxLength={120}
            placeholder="Ej. Responsiva general"
            className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-500/60"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-white">Tipo</span>
          <select
            name="document_type"
            defaultValue="waiver"
            className="w-full rounded-2xl border border-white/10 bg-[#11131b] px-4 py-3 text-sm text-white"
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
          <span className="mb-2 block text-sm font-semibold text-white">Descripción interna</span>
          <textarea
            name="description"
            rows={4}
            maxLength={500}
            placeholder="Explica brevemente para qué se usa."
            className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-fuchsia-500/60"
          />
        </label>

        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4 text-sm leading-6 text-cyan-100/80">
          Crear este borrador no afecta a ninguna alumna ni bloquea reservas.
        </div>

        <button className="w-full rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500">
          Crear borrador y continuar
        </button>
      </form>
    </main>
  );
}
