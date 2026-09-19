export type CommunicationPreferenceCategory =
  | "operational"
  | "reminders"
  | "retention"
  | "promotions";

export interface PersonCommunicationPreferences {
  operational: boolean;
  reminders: boolean;
  retention: boolean;
  promotions: boolean;
  whatsappBlocked: boolean;
}

export const DEFAULT_PERSON_COMMUNICATION_PREFERENCES: PersonCommunicationPreferences = {
  operational: true,
  reminders: true,
  retention: true,
  promotions: true,
  whatsappBlocked: false,
};

export interface CommunicationPreferenceResolution {
  decision: "allow" | "suppress";
  category: CommunicationPreferenceCategory;
  reasonCode:
    | "communication_preference_allowed"
    | "person_whatsapp_blocked"
    | "person_category_opt_out"
    | "global_category_disabled";
  reason: string;
  personRestricted: boolean;
  globalRestricted: boolean;
}

function categoryEnabled(
  preferences: PersonCommunicationPreferences,
  category: CommunicationPreferenceCategory,
): boolean {
  return preferences[category];
}

export function resolvePersonCommunicationPreference(input: {
  category: CommunicationPreferenceCategory;
  preferences?: PersonCommunicationPreferences;
  globalAllowed?: boolean;
}): CommunicationPreferenceResolution {
  const preferences = input.preferences ?? DEFAULT_PERSON_COMMUNICATION_PREFERENCES;
  const globalAllowed = input.globalAllowed ?? true;

  if (preferences.whatsappBlocked) {
    return {
      decision: "suppress",
      category: input.category,
      reasonCode: "person_whatsapp_blocked",
      reason: "La persona bloqueó todas las comunicaciones por WhatsApp.",
      personRestricted: true,
      globalRestricted: !globalAllowed,
    };
  }

  if (!categoryEnabled(preferences, input.category)) {
    return {
      decision: "suppress",
      category: input.category,
      reasonCode: "person_category_opt_out",
      reason: "La persona desactivó esta categoría de comunicación.",
      personRestricted: true,
      globalRestricted: !globalAllowed,
    };
  }

  if (!globalAllowed) {
    return {
      decision: "suppress",
      category: input.category,
      reasonCode: "global_category_disabled",
      reason: "La configuración global no permite esta categoría de comunicación.",
      personRestricted: false,
      globalRestricted: true,
    };
  }

  return {
    decision: "allow",
    category: input.category,
    reasonCode: "communication_preference_allowed",
    reason: "La persona y la configuración global permiten esta categoría.",
    personRestricted: false,
    globalRestricted: false,
  };
}

export interface WhatsAppContactValidation {
  outcome: "valid" | "data_error";
  reasonCode: "whatsapp_contact_valid" | "whatsapp_contact_invalid";
  reason: string;
  normalizedRecipient: string | null;
}

export function validateWhatsAppContact(recipient: string | null | undefined): WhatsAppContactValidation {
  const normalized = recipient?.trim() ?? "";
  const valid = /^\+[1-9][0-9]{7,14}$/.test(normalized);

  if (!valid) {
    return {
      outcome: "data_error",
      reasonCode: "whatsapp_contact_invalid",
      reason: "El teléfono no es un destinatario E.164 válido para WhatsApp.",
      normalizedRecipient: normalized || null,
    };
  }

  return {
    outcome: "valid",
    reasonCode: "whatsapp_contact_valid",
    reason: "El teléfono tiene formato E.164 válido.",
    normalizedRecipient: normalized,
  };
}
