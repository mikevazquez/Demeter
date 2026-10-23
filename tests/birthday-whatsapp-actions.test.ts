import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BIRTHDAY_META_BODY,
  BIRTHDAY_MONTH_META_BODY,
} from "../supabase/functions/_shared/birthday-notification";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  rpc: vi.fn(),
  diagnostics: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/admin-context", () => ({ getAdminContext: mocks.context }));
vi.mock("@/lib/assistant/meta-whatsapp-admin", () => ({
  getMetaWhatsAppAdminDiagnostics: mocks.diagnostics,
  submitMetaWhatsAppTemplate: mocks.submit,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc: async () => ({ error: null }) }),
}));

import {
  mapApprovedNotificationWhatsAppTemplateAction,
  submitNotificationWhatsAppTemplateAction,
  updateBirthdayNotificationAction,
} from "../app/admin/notificaciones/actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
function diagnostics(status = "APPROVED", category = "MARKETING", variableCount = 2) {
  return {
    connected: true,
    templateLanguage: "es_MX",
    templateMappings: { birthday: "demeter_cumpleanos" },
    templates: [{ name: "demeter_cumpleanos", status, language: "es_MX", category, variableCount }],
  };
}
let snapshot: { settings: { whatsapp_enabled: boolean }; rules: Array<Record<string, unknown>> };
beforeEach(() => {
  vi.clearAllMocks();
  snapshot = {
    settings: { whatsapp_enabled: true },
    rules: [
      {
        rule_key: "marketing.birthday",
        template_key: "birthday",
        channels: [{ channel_key: "inbox" }, { channel_key: "whatsapp" }],
      },
    ],
  };
  mocks.rpc.mockImplementation(async (name: string) =>
    name === "admin_notification_rules_snapshot"
      ? { data: snapshot }
      : name === "admin_get_meta_whatsapp_connection_summary"
        ? { data: { connected: true, templates: { student_welcome: "welcome" } } }
        : { data: true },
  );
  mocks.context.mockResolvedValue({ supabase: { rpc: mocks.rpc }, studio: { id: "studio-a", name: "Demeter Fitness Studio" },
  });
  mocks.diagnostics.mockResolvedValue(diagnostics());
});

const activate = () =>
  updateBirthdayNotificationAction(
    form({ rule_key: "marketing.birthday", operation: "enabled", next_enabled: "true" }),
  );
const mutations = () => mocks.rpc.mock.calls.filter(([name]) => /admin_set_/.test(name));

describe("Birthday WhatsApp activation", () => {
  it.each([
    ["PENDING", "MARKETING", 2],
    ["REJECTED", "MARKETING", 2],
    ["APPROVED", "UTILITY", 2],
    ["APPROVED", "MARKETING", 1],
  ])(
    "rejects status %s, category %s and %s variables before mutation",
    async (status, category, count) => {
      mocks.diagnostics.mockResolvedValue(diagnostics(status, category, count));
      await expect(activate()).rejects.toThrow("channel_not_ready_whatsapp");
      expect(mutations()).toHaveLength(0);
    },
  );
  it("rejects global WhatsApp off and a rule without WhatsApp selected", async () => {
    snapshot.settings.whatsapp_enabled = false;
    await expect(activate()).rejects.toThrow("channel_not_ready_whatsapp");
    snapshot.settings.whatsapp_enabled = true;
    snapshot.rules[0].channels = [{ channel_key: "inbox" }];
    await expect(activate()).rejects.toThrow("birthday_whatsapp_required");
    expect(mutations()).toHaveLength(0);
  });
  it("activates only the birthday rule in the authenticated study", async () => {
    await expect(activate()).rejects.toThrow("saved=enabled_enabled");
    expect(mutations()).toEqual([
      [
        "admin_set_notification_rules_enabled",
        { p_studio_id: "studio-a", p_rule_keys: ["marketing.birthday"], p_enabled: true },
      ],
    ]);
    expect(mocks.context).toHaveBeenCalledWith("automations.manage");
  });
  it("can pause even if Meta is disconnected", async () => {
    mocks.diagnostics.mockResolvedValue({ ...diagnostics(), connected: false });
    await expect(
      updateBirthdayNotificationAction(
        form({ rule_key: "marketing.birthday", operation: "enabled", next_enabled: "false" }),
      ),
    ).rejects.toThrow("saved=enabled_disabled");
    expect(mutations()[0][1]).toMatchObject({ p_enabled: false });
  });
  it("pauses the trigger before removing its only WhatsApp channel", async () => {
    await expect(
      updateBirthdayNotificationAction(
        form({
          rule_key: "marketing.birthday",
          operation: "channel",
          channel: "whatsapp",
          next_enabled: "false",
        }),
      ),
    ).rejects.toThrow("saved=channel_disabled");
    expect(mutations()).toEqual([
      [
        "admin_set_notification_rules_enabled",
        { p_studio_id: "studio-a", p_rule_keys: ["marketing.birthday"], p_enabled: false },
      ],
      [
        "admin_set_notification_rules_channel",
        {
          p_studio_id: "studio-a",
          p_rule_keys: ["marketing.birthday"],
          p_channel_key: "whatsapp",
          p_enabled: false,
        },
      ],
    ]);
  });
  it("rejects unrelated rules and channels", async () => {
    await expect(
      updateBirthdayNotificationAction(
        form({
          rule_key: "marketing.package_recovery_1",
          operation: "enabled",
          next_enabled: "true",
        }),
      ),
    ).rejects.toThrow("rule_invalid");
    await expect(
      updateBirthdayNotificationAction(
        form({
          rule_key: "marketing.birthday",
          operation: "channel",
          channel: "push",
          next_enabled: "true",
        }),
      ),
    ).rejects.toThrow("notification_channel_invalid");
    expect(mutations()).toHaveLength(0);
  });
});

describe("Birthday Meta template registration and mapping", () => {
  const draft = () =>
    form({
      marketing_key: "birthday",
      template_key: "birthday",
      meta_template_name: "demeter_cumpleanos",
      language_code: "es_MX",
      meta_category: "MARKETING",
      meta_body: BIRTHDAY_META_BODY,
    });
  it("registers the greeting with ordered examples and settings permission", async () => {
    mocks.diagnostics.mockResolvedValue({ ...diagnostics(), templates: [] });
    await expect(submitNotificationWhatsAppTemplateAction(draft())).rejects.toThrow(
      "saved=whatsapp_template_submitted",
    );
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        studioId: "studio-a",
        category: "MARKETING",
        body: BIRTHDAY_META_BODY,
        expectedVariables: 2,
        exampleValues: ["Camila", "Demeter Fitness Studio"],
      }),
    );
    expect(mocks.context).toHaveBeenCalledWith("settings.write");
    expect(mutations()).toHaveLength(0);
  });
  it("does not submit a second copy of an existing pending template", async () => {
    mocks.diagnostics.mockResolvedValue(diagnostics("PENDING"));
    await expect(submitNotificationWhatsAppTemplateAction(draft())).rejects.toThrow(
      "saved=whatsapp_template_exists",
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("rejects altered birthday content and non-marketing category", async () => {
    for (const [key, value] of [
      ["meta_body", "another message"],
      ["meta_category", "UTILITY"],
    ]) {
      const data = draft();
      data.set(key, value);
      await expect(submitNotificationWhatsAppTemplateAction(data)).rejects.toThrow(
        "notification_whatsapp_template_invalid",
      );
    }
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each(["PENDING", "REJECTED"])("does not map a %s template", async (status) => {
    mocks.diagnostics.mockResolvedValue(diagnostics(status));
    await expect(mapApprovedNotificationWhatsAppTemplateAction(draft())).rejects.toThrow(
      "notification_whatsapp_template_not_approved",
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "admin_update_meta_whatsapp_templates",
      expect.anything(),
    );
  });
  it("maps the approved birthday template while preserving existing mappings", async () => {
    await expect(mapApprovedNotificationWhatsAppTemplateAction(draft())).rejects.toThrow(
      "saved=whatsapp_template_mapped",
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "admin_update_meta_whatsapp_templates",
      expect.objectContaining({
        target_studio_id: "studio-a",
        target_templates: { student_welcome: "welcome", birthday: "demeter_cumpleanos" },
      }),
    );
    expect(mutations()).toHaveLength(0);
  });
});

describe("CUMP-01 · day-1 notice and gift settings", () => {
  it("accepts the day-1 template body for registration", async () => {
    mocks.diagnostics.mockResolvedValue({ ...diagnostics(), templates: [] });
    const data = form({
      marketing_key: "birthday",
      template_key: "birthday_month",
      meta_template_name: "mes_cumpleanos_regalo",
      language_code: "es_MX",
      meta_category: "MARKETING",
      meta_body: BIRTHDAY_MONTH_META_BODY,
    });
    await expect(submitNotificationWhatsAppTemplateAction(data)).rejects.toThrow(
      "saved=whatsapp_template_submitted",
    );
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ body: BIRTHDAY_MONTH_META_BODY, expectedVariables: 2 }),
    );
  });
  it("does not activate the day-1 notice while the gift is off", async () => {
    snapshot.rules.push({
      rule_key: "marketing.birthday_month",
      template_key: "birthday_month",
      channels: [{ channel_key: "whatsapp" }],
    });
    mocks.diagnostics.mockResolvedValue({
      connected: true,
      templateLanguage: "es_MX",
      templateMappings: { birthday_month: "mes_cumpleanos_regalo" },
      templates: [
        {
          name: "mes_cumpleanos_regalo",
          status: "APPROVED",
          language: "es_MX",
          category: "MARKETING",
          variableCount: 2,
        },
      ],
    });
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "admin_notification_rules_snapshot"
        ? { data: snapshot }
        : name === "admin_birthday_settings"
          ? { data: { gift_enabled: false } }
          : { data: true },
    );
    await expect(
      updateBirthdayNotificationAction(
        form({ rule_key: "marketing.birthday_month", operation: "enabled", next_enabled: "true" }),
      ),
    ).rejects.toThrow("birthday_gift_disabled");
    expect(mutations()).toHaveLength(0);
  });
  it("saves the gift settings with settings permission", async () => {
    const { saveBirthdayGiftSettingsAction } = await import("../app/admin/notificaciones/actions");
    const data = form({ gift_enabled: "on" });
    await expect(saveBirthdayGiftSettingsAction(data)).rejects.toThrow("saved=birthday_settings");
    expect(mocks.rpc).toHaveBeenCalledWith("admin_update_birthday_settings", {
      p_studio_id: "studio-a",
      p_gift_enabled: true,
      p_gift_friend_enabled: false,
    });
    expect(mocks.context).toHaveBeenCalledWith("settings.write");
  });
});
