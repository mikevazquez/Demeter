"use client";

import { useEffect } from "react";

export default function StudentPortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[student.portal] render error", error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <section className="w-full max-w-xl rounded-3xl border border-rose-500/20 bg-rose-500/[0.06] p-6 text-center sm:p-8">
        <div
          aria-hidden="true"
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-400/10 text-xl text-rose-200"
        >
          !
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-rose-200">
          Problema temporal
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">No pudimos cargar tu información</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-400">
          Ocurrió un problema al cargar el portal. Tus datos no se modificaron.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 min-h-11 rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
        >
          Reintentar
        </button>
      </section>
    </main>
  );
}
