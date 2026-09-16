import Link from "next/link";

import { getStudentPortalContext } from "@/lib/student/portal";

export default async function StudentDocumentsPage() {
  await getStudentPortalContext();

  return (
    <main className="mx-auto max-w-2xl space-y-6">
      <header>
        <p className="text-sm text-fuchsia-300">Documentos</p>
        <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">Tus documentos</h1>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-7 text-center sm:p-9">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-fuchsia-500/10 text-xl text-fuchsia-300">
          ◇
        </div>
        <h2 className="mt-4 text-xl font-semibold text-white">Se habilitará en F12</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-400">
          El Documento Maestro asigna versiones, documentos pendientes y aceptación a la fase de
          Documentos/Configuración. F10 sólo deja preparado el acceso desde tu perfil; no
          mostraremos documentos ficticios ni estados simulados.
        </p>
        <Link
          href="/student/perfil"
          className="mt-5 inline-block rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.05]"
        >
          Volver a Perfil
        </Link>
      </section>
    </main>
  );
}
