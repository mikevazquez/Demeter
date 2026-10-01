export default function SetupLoading() {
  return (
    <main className="auth-shell" aria-live="polite" aria-busy="true">
      <section className="auth-card">
        <div className="grid gap-3">
          <span className="h-3 w-32 animate-pulse rounded-full bg-fuchsia-400/15" />
          <span className="h-10 w-64 max-w-full animate-pulse rounded-xl bg-white/10" />
          <span className="h-4 w-full animate-pulse rounded-lg bg-white/[0.07]" />
          <span className="mt-3 h-14 animate-pulse rounded-xl border border-white/10 bg-white/[0.04]" />
          <span className="h-14 animate-pulse rounded-xl border border-white/10 bg-white/[0.04]" />
          <span className="h-12 animate-pulse rounded-xl bg-fuchsia-500/20" />
        </div>
        <span className="sr-only">Preparando configuración…</span>
      </section>
    </main>
  );
}
