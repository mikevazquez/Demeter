import { MODULE_LABEL } from "@/lib/platform/entitlements";
import type { PlatformModuleKey } from "@/lib/platform/catalog";

// NEB-01-03 · En el portal de la alumna un módulo no contratado simplemente no está disponible.
export default function ModuleLocked({ module: moduleKey }: { module: PlatformModuleKey }) {
  return (
    <main className="space-y-4 pb-4">
      <section className="sendero-surface p-5 text-sm leading-6 text-[var(--sendero-muted)]">
        <p className="sendero-eyebrow">{MODULE_LABEL[moduleKey]}</p>
        <p className="mt-2">Esta sección no está disponible en tu estudio por ahora.</p>
      </section>
    </main>
  );
}
