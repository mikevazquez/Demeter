export default function ResponsibleLoading() {
  return (
    <main
      className="min-h-screen bg-[#090a0f] px-4 py-8 text-white sm:px-6"
      aria-live="polite"
      aria-busy="true"
    >
      <section className="mx-auto max-w-xl space-y-5">
        <header className="grid justify-items-center gap-2">
          <span className="h-3 w-28 animate-pulse rounded-full bg-fuchsia-400/15" />
          <span className="h-8 w-64 max-w-full animate-pulse rounded-xl bg-white/10" />
          <span className="h-4 w-80 max-w-full animate-pulse rounded-lg bg-white/[0.06]" />
        </header>
        <div className="h-56 animate-pulse rounded-[32px] border border-white/10 bg-white/[0.035]" />
        <div className="h-20 animate-pulse rounded-2xl border border-white/10 bg-black/20" />
        <span className="sr-only">Cargando documentos…</span>
      </section>
    </main>
  );
}
