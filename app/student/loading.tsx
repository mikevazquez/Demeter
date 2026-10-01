export default function StudentLoading() {
  return (
    <main className="space-y-4 pb-4" aria-live="polite" aria-busy="true">
      <header className="space-y-2">
        <span className="block h-3 w-24 animate-pulse rounded-full bg-fuchsia-400/15" />
        <span className="block h-8 w-56 animate-pulse rounded-xl bg-white/10" />
      </header>

      <section className="grid gap-3">
        <div className="h-32 animate-pulse rounded-[26px] border border-white/10 bg-white/[0.035]" />
        <div className="h-24 animate-pulse rounded-[24px] border border-white/10 bg-white/[0.03]" />
        <div className="h-24 animate-pulse rounded-[24px] border border-white/10 bg-white/[0.03]" />
      </section>

      <section className="grid gap-2">
        <div className="h-16 animate-pulse rounded-2xl border border-white/10 bg-black/20" />
        <div className="h-16 animate-pulse rounded-2xl border border-white/10 bg-black/20" />
      </section>

      <span className="sr-only">Cargando tu información…</span>
    </main>
  );
}
