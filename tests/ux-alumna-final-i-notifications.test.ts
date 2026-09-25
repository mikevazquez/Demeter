import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ALUMNA UX FINAL I · Notificaciones", () => {
  const inbox = source("app/student/notificaciones/page.tsx");
  const detail = source("app/student/notificaciones/[notificationId]/page.tsx");
  const preferences = source("app/student/perfil/notificaciones/page.tsx");
  const channels = source("app/student/components/NotificationChannelPreferences.tsx");
  const home = source("app/student/page.tsx");
  const layout = source("app/student/layout.tsx");

  it("keeps the bell as notification history instead of settings", () => {
    expect(layout).toContain('href="/student/notificaciones"');
    expect(layout).not.toContain('href="/student/perfil/notificaciones"');
    expect(inbox).toContain("Notificaciones");
    expect(inbox).not.toContain("Tus avisos");
  });

  it("keeps only action-changing alerts on Home", () => {
    expect(home).toContain("urgentNotificationTypes");
    expect(home).toContain('"class_cancelled_student"');
    expect(home).toContain('"class_rescheduled"');
    expect(home).toContain('"waitlist_promoted"');
    expect(home).not.toContain('"evaluation_completed",');
  });

  it("uses human student language in notification detail", () => {
    expect(detail).toContain("Tu clase fue devuelta a tu paquete.");
    expect(detail).not.toContain("Tu crédito fue restaurado.");
    expect(detail).toContain("Buscar otra clase");
    expect(detail).toContain("Ver mis clases");
    expect(detail).toContain("Ver nivel técnico");
  });

  it("keeps channel preferences in Profile and does not offer inactive email delivery", () => {
    expect(preferences).toContain('href="/student/perfil"');
    expect(preferences).toContain("Elige cómo quieres recibir los avisos");
    expect(channels).toContain("Push activado ✓");
    expect(channels).toContain("Push necesita permiso en este dispositivo");
    expect(channels).toContain("Las notificaciones están bloqueadas en este dispositivo");
    expect(channels).toContain("Instala Demeter para recibir notificaciones Push");
    expect(channels).toContain("Reservas, recordatorios y avisos importantes.");
    expect(channels).toContain("Próximamente");
    expect(channels).not.toContain('toggleChannel("email")');
  });

  it("keeps the persistent Push preference separate from device connection state", () => {
    expect(channels).toContain("preferences.push_enabled");
    expect(channels).toContain('deviceState === "connected"');
    expect(channels).toContain('deviceState === "blocked"');
    expect(channels).toContain('deviceState === "needs_install"');
    expect(channels).toContain("aria-checked={checked}");
  });
});
