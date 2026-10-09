export type OutboundChannel = "push" | "whatsapp" | "email";

export type ChannelReadiness = {
  ready: boolean;
  label: string;
  detail: string;
};

export type ChannelReadinessInput = {
  globalEnabled: Record<OutboundChannel, boolean>;
  pushProviderConfigured: boolean;
  whatsappConnected: boolean;
  whatsappTemplateName: string | null;
  whatsappTemplateLanguage: string;
  whatsappTemplateStatus: string | null;
  whatsappTemplateVariables: number | null;
  expectedWhatsappVariables: number | null;
  emailProviderConfigured: boolean;
};

/**
 * A channel can be selected only when both Studio Flow's global setting and its
 * provider-specific prerequisites are satisfied. Recipient consent/subscription
 * is checked again at delivery time and is intentionally not inferred here.
 */
export function getChannelReadiness(
  input: ChannelReadinessInput,
): Record<OutboundChannel, ChannelReadiness> {
  const pushReady = input.globalEnabled.push && input.pushProviderConfigured;
  const whatsappTemplateCompatible =
    Boolean(input.whatsappTemplateName) &&
    input.whatsappTemplateStatus?.toUpperCase() === "APPROVED" &&
    input.whatsappTemplateVariables === input.expectedWhatsappVariables;
  const whatsappReady =
    input.globalEnabled.whatsapp && input.whatsappConnected && whatsappTemplateCompatible;
  const emailReady = input.globalEnabled.email && input.emailProviderConfigured;

  return {
    push: {
      ready: pushReady,
      label: pushReady ? "Listo" : "Falta configuración",
      detail: !input.globalEnabled.push
        ? "Push está desactivado en Preferencias."
        : input.pushProviderConfigured
          ? "El proveedor Push está configurado; cada alumna necesita una suscripción vigente."
          : "Falta la configuración técnica Push (VAPID).",
    },
    whatsapp: {
      ready: whatsappReady,
      label: whatsappReady ? "Plantilla aprobada" : "Falta configuración",
      detail: !input.globalEnabled.whatsapp
        ? "WhatsApp está desactivado en Preferencias."
        : !input.whatsappConnected
          ? "Falta conectar Meta WhatsApp."
          : !input.whatsappTemplateName
            ? "Asigna una plantilla de Meta a este evento."
            : input.whatsappTemplateStatus?.toUpperCase() !== "APPROVED"
              ? "La plantilla debe estar aprobada por Meta."
              : input.whatsappTemplateVariables !== input.expectedWhatsappVariables
                ? "Las variables de la plantilla no coinciden con las que envía este evento."
                : "Meta y la plantilla están listos; el consentimiento y el teléfono se validan al enviar.",
    },
    email: {
      ready: emailReady,
      label: emailReady ? "Listo" : "Proveedor no configurado",
      detail: !input.globalEnabled.email
        ? "Email está desactivado en Preferencias."
        : input.emailProviderConfigured
          ? "El proveedor de email está configurado."
          : "Falta conectar y validar un proveedor de email.",
    },
  };
}
