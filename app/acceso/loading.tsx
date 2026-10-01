export default function StudentAccessLoading() {
  return (
    <main className="auth-shell auth-login-shell" aria-live="polite" aria-busy="true">
      <section className="auth-card auth-login-card">
        <div className="auth-login-header">
          <div className="auth-brand" aria-hidden="true">
            <strong>DEMETER</strong>
          </div>
        </div>
        <div className="grid gap-3">
          <span className="h-7 w-48 animate-pulse rounded-xl bg-white/10" />
          <span className="h-4 w-72 max-w-full animate-pulse rounded-lg bg-white/[0.07]" />
          <span className="mt-3 h-[58px] animate-pulse rounded-[10px] border border-white/10 bg-white/[0.04]" />
          <span className="h-[50px] animate-pulse rounded-[9px] bg-fuchsia-500/20" />
        </div>
        <span className="sr-only">Revisando tu acceso…</span>
      </section>
    </main>
  );
}
