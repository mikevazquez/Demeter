import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaWhatsAppAdminDiagnostics } from "../lib/assistant/meta-whatsapp-admin";

vi.mock("../app/admin/notificaciones/actions", () => ({
  updateBirthdayNotificationAction: async () => {},
  submitNotificationWhatsAppTemplateAction: async () => {},
  mapApprovedNotificationWhatsAppTemplateAction: async () => {},
  saveBirthdayGiftSettingsAction: async () => {},
}));
import { BirthdayNotificationEditor } from "../app/admin/notificaciones/marketing/BirthdayNotificationEditor";
const rpc = vi.fn();
const diagnostics = {
  connected: true,
  templateLanguage: "es_MX",
  templateMappings: {},
  templates: [],
} as unknown as MetaWhatsAppAdminDiagnostics;
const props = () => ({
  supabase: { rpc } as unknown as SupabaseClient,
  studioId: "studio-a",
  studioName: "Demeter",
  rule: { enabled: false, channels: [{ channel_key: "inbox" }] },
  diagnostics,
  monthRule: { enabled: false, channels: [{ channel_key: "whatsapp" }] },
  readiness: {
    ready: false,
    label: "Falta configuración",
    detail: "Asigna una plantilla de Meta a este evento.",
  },
  monthReadiness: {
    ready: false,
    label: "Falta configuración",
    detail: "Asigna una plantilla de Meta a este evento.",
  },
  canManage: true,
  canManageTemplates: true,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T05:30:00Z"));
  rpc.mockResolvedValue({
    data: { students: [{ id: "demo", name: "Demo · Camila Torres" }] },
    error: null,
  });
});
afterEach(() => vi.useRealTimers());
describe("Birthday WhatsApp editor", () => {
  it("defaults the preview to the Mexico date and shows the actual demo greeting", async () => {
    const html = renderToStaticMarkup(await BirthdayNotificationEditor(props()));
    expect(rpc).toHaveBeenCalledWith("admin_birthday_notification_preview", {
      p_studio_id: "studio-a",
      p_day: "2026-10-19",
    });
    expect(html).toContain("¡Feliz cumpleaños, Demo · Camila Torres!");
    expect(html).toContain("Enviar plantilla a aprobación de Meta");
    expect(html).toContain("No programa ni envía mensajes");
    expect(html).toContain("<svg");
    expect(html).not.toContain("🎂");
    expect(html).toMatch(/disabled=""[^>]*>Activar disparador/);
  });
  it("uses the requested date and discards malformed calendar dates", async () => {
    await BirthdayNotificationEditor({ ...props(), previewDate: "2026-11-14" });
    expect(rpc).toHaveBeenCalledWith("admin_birthday_notification_preview", {
      p_studio_id: "studio-a",
      p_day: "2026-11-14",
    });
    expect(rpc).toHaveBeenCalledWith("admin_birthday_month_notification_preview", {
      p_studio_id: "studio-a",
      p_month_start: "2026-11-01",
    });
    rpc.mockClear();
    await BirthdayNotificationEditor({ ...props(), previewDate: "2026-02-30" });
    expect(rpc).toHaveBeenCalledWith("admin_birthday_notification_preview", {
      p_studio_id: "studio-a",
      p_day: "2026-10-19",
    });
  });
  it("does not display activation or registration actions to read-only staff", async () => {
    const html = renderToStaticMarkup(
      await BirthdayNotificationEditor({ ...props(), canManage: false, canManageTemplates: false }),
    );
    expect(html).not.toContain("Activar disparador");
    expect(html).not.toContain("Enviar plantilla a aprobación de Meta");
    expect(html).toContain("Demo · Camila Torres");
  });
  it("distinguishes query failure from no eligible birthdays", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "forbidden" } });
    const failed = renderToStaticMarkup(await BirthdayNotificationEditor(props()));
    expect(failed).toContain("No se pudo consultar");
    expect(failed).not.toContain("No hay cumpleaños");
    rpc.mockResolvedValueOnce({ data: { students: [] } });
    expect(renderToStaticMarkup(await BirthdayNotificationEditor(props()))).toContain(
      "No hay cumpleaños de alumnas activas",
    );
  });
  it("shows the gift settings and the day-1 notice with the studio name", async () => {
    const html = renderToStaticMarkup(await BirthdayNotificationEditor(props()));
    expect(html).toContain("Regalo de cumpleaños");
    expect(html).toContain("Guardar regalo");
    expect(html).toContain("Aviso del regalo · día 1 de su mes");
    expect(html).toContain("¡Demo · Camila Torres, este mes te festejamos en Demeter!");
  });
  it("blocks the day-1 notice when the gift is off", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "admin_birthday_settings"
        ? { data: { gift_enabled: false, gift_friend_enabled: true }, error: null }
        : { data: { students: [{ id: "demo", name: "Demo · Camila Torres" }] }, error: null },
    );
    const html = renderToStaticMarkup(await BirthdayNotificationEditor(props()));
    expect(html).toContain("El regalo está apagado: este aviso no se puede activar.");
    expect(html).toContain("no se envía el aviso del día 1");
  });
});
