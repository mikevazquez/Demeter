import { MODULE_LABEL } from "@/lib/platform/entitlements";
import type { PlatformModuleKey } from "@/lib/platform/catalog";

// NEB-01-03 · Pantalla para un módulo que el estudio no tiene contratado.
export default function ModuleLocked({
  module: moduleKey,
  surface,
  isOwner = false,
}: {
  module: PlatformModuleKey;
  surface: "admin" | "student";
  isOwner?: boolean;
}) {
  const label = MODULE_LABEL[moduleKey];

  if (surface === "student") {
    return (
      <main className="space-y-4 pb-4">
        <section className="sendero-surface p-5 text-sm leading-6 text-[var(--sendero-muted)]">
          <p className="sendero-eyebrow">{label}</p>
          <p className="mt-2">Esta sección no está disponible en tu estudio por ahora.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell admin-module-page admin-ux04-secondary">
      <header className="module-header">
        <div>
          <h1>{label}</h1>
          <p>Este módulo no está incluido en el plan de tu estudio.</p>
        </div>
      </header>
      <section className="empty-state">
        {isOwner
          ? `Si quieres usar ${label}, pídele a Nébora que lo active en tu plan.`
          : `Pídele a la persona dueña del estudio que active ${label}.`}
      </section>
    </main>
  );
}
