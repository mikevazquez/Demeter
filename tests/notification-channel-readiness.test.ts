import { describe, expect, it } from "vitest";

import {
  getChannelReadiness,
  type ChannelReadinessInput,
} from "../lib/notifications/channel-readiness";

const baseInput: ChannelReadinessInput = {
  globalEnabled: { push: true, whatsapp: true, email: true },
  pushProviderConfigured: true,
  whatsappConnected: true,
  whatsappTemplateName: "demeter_recuperacion_paquete_1",
  whatsappTemplateLanguage: "es_MX",
  whatsappTemplateStatus: "APPROVED",
  whatsappTemplateVariables: 3,
  expectedWhatsappVariables: 3,
  emailProviderConfigured: false,
};

describe("getChannelReadiness", () => {
  it("marks Push and a compatible approved WhatsApp template as ready", () => {
    const readiness = getChannelReadiness(baseInput);

    expect(readiness.push.ready).toBe(true);
    expect(readiness.whatsapp.ready).toBe(true);
    expect(readiness.email.ready).toBe(false);
  });

  it("blocks WhatsApp unless Meta connection, approval, and variable count all match", () => {
    expect(
      getChannelReadiness({ ...baseInput, whatsappConnected: false }).whatsapp.ready,
    ).toBe(false);
    expect(
      getChannelReadiness({ ...baseInput, whatsappTemplateStatus: "PENDING" }).whatsapp.ready,
    ).toBe(false);
    expect(
      getChannelReadiness({ ...baseInput, whatsappTemplateVariables: 2 }).whatsapp.ready,
    ).toBe(false);
  });

  it("blocks a channel when its global preference is off", () => {
    const readiness = getChannelReadiness({
      ...baseInput,
      globalEnabled: { push: false, whatsapp: false, email: false },
    });

    expect(readiness.push.ready).toBe(false);
    expect(readiness.whatsapp.ready).toBe(false);
    expect(readiness.email.ready).toBe(false);
  });
});
