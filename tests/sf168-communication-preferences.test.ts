import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PERSON_COMMUNICATION_PREFERENCES,
  resolvePersonCommunicationPreference,
  validateWhatsAppContact,
} from "../lib/automations/communication-preferences";
import { resolveAutomationCommunication } from "../lib/automations/communication-control";

describe("SF-168 communication preferences", () => {
  it("keeps operational messages enabled when promotions are opted out", () => {
    const preferences = {
      ...DEFAULT_PERSON_COMMUNICATION_PREFERENCES,
      promotions: false,
    };

    expect(
      resolvePersonCommunicationPreference({
        category: "promotions",
        preferences,
      }),
    ).toMatchObject({
      decision: "suppress",
      reasonCode: "person_category_opt_out",
      personRestricted: true,
    });

    expect(
      resolvePersonCommunicationPreference({
        category: "operational",
        preferences,
      }),
    ).toMatchObject({
      decision: "allow",
      reasonCode: "communication_preference_allowed",
    });
  });

  it("lets an individual restriction prevail over a globally allowed category", () => {
    const result = resolvePersonCommunicationPreference({
      category: "retention",
      globalAllowed: true,
      preferences: {
        ...DEFAULT_PERSON_COMMUNICATION_PREFERENCES,
        retention: false,
      },
    });

    expect(result).toMatchObject({
      decision: "suppress",
      reasonCode: "person_category_opt_out",
      personRestricted: true,
      globalRestricted: false,
    });
  });

  it("blocks every category when WhatsApp is blocked", () => {
    const preferences = {
      ...DEFAULT_PERSON_COMMUNICATION_PREFERENCES,
      whatsappBlocked: true,
    };

    for (const category of ["operational", "reminders", "retention", "promotions"] as const) {
      expect(resolvePersonCommunicationPreference({ category, preferences })).toMatchObject({
        decision: "suppress",
        reasonCode: "person_whatsapp_blocked",
      });
    }
  });

  it("feeds an individual opt-out into AUT-05 as a suppression", () => {
    const preference = resolvePersonCommunicationPreference({
      category: "retention",
      preferences: {
        ...DEFAULT_PERSON_COMMUNICATION_PREFERENCES,
        retention: false,
      },
    });

    expect(
      resolveAutomationCommunication({
        key: "inactive:student-1",
        catalogCode: "AUT-CAT-14",
        preference,
      }),
    ).toMatchObject({
      decision: "suppress",
      reasonCode: "person_category_opt_out",
      details: {
        communication_preference: {
          category: "retention",
          person_restricted: true,
        },
      },
    });
  });

  it("treats an invalid phone as a data error instead of an opt-out", () => {
    expect(validateWhatsAppContact("331234")).toMatchObject({
      outcome: "data_error",
      reasonCode: "whatsapp_contact_invalid",
    });

    expect(validateWhatsAppContact("+523312345678")).toMatchObject({
      outcome: "valid",
      reasonCode: "whatsapp_contact_valid",
    });
  });

  it("keeps the audit table append-only and system RPC service-only", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260919060127_sf168_communication_preferences.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("person_communication_preference_events_immutable");
    expect(migration).toContain("communication_preference_history_immutable");
    expect(migration).toContain(
      "grant execute on function public.system_set_person_communication_preferences",
    );
    expect(migration).toContain("from public, anon, authenticated;");
  });
});
