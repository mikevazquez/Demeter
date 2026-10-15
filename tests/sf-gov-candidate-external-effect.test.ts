import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertCandidateExternalEffectAllowed,
  assertCandidateRuntimeExternalEffectAllowed,
  type CandidateExternalEffect,
} from "@/lib/assistant/external-effect-policy";

const effects: CandidateExternalEffect[] = [
  "meta_whatsapp_send",
  "meta_inbox_send",
  "meta_whatsapp_media_read",
  "meta_inbox_media_read",
  "openai_responses",
  "openai_transcription",
  "meta_admin_request",
  "asistian_webhook",
  "auth_confirmation_email",
  "exchange_rate_read",
  "notification_worker_trigger",
  "followup_worker_trigger",
];

describe("SF-GOV-001 Candidate external effect isolation", () => {
  it("guards Demi UAT worker dispatch before any locked side effects", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/admin/mas/demi/uat/actions.ts", "utf8");
    for (const [name, effect] of [
      ["runDemiUatNotifications", "notification_worker_trigger"],
      ["runDemiUatFollowups", "followup_worker_trigger"],
    ]) {
      const start = source.indexOf(`export async function ${name}(`);
      expect(start).toBeGreaterThanOrEqual(0);
      const segment = source.slice(start, start + 360);
      const denial = segment.indexOf(`assertCandidateRuntimeExternalEffectAllowed("${effect}")`);
      const locked = segment.indexOf("await locked(");
      expect(denial, name).toBeGreaterThanOrEqual(0);
      expect(locked, name).toBeGreaterThan(denial);
    }
  });

  afterEach(() => vi.unstubAllEnvs());
  for (const effect of effects) {
    it(`blocks real ${effect} in Candidate Preview`, () => {
      expect(() => assertCandidateExternalEffectAllowed({ effect, candidatePreview: "1" })).toThrow(
        `candidate_preview_external_effect_forbidden:${effect}`,
      );
    });
  }

  it("fails closed on a misconfigured nonempty Candidate flag", () => {
    expect(() =>
      assertCandidateExternalEffectAllowed({
        effect: "meta_whatsapp_send",
        candidatePreview: "true",
      }),
    ).toThrow("candidate_preview_external_effect_forbidden:meta_whatsapp_send");
  });

  it("preserves historical Sandbox and production behavior when Candidate flag is off", () => {
    for (const effect of effects) {
      expect(() => assertCandidateExternalEffectAllowed({ effect })).not.toThrow();
      expect(() =>
        assertCandidateExternalEffectAllowed({ effect, candidatePreview: "0" }),
      ).not.toThrow();
    }
  });

  it("blocks Candidate identity even when the flag is absent, empty or disabled", () => {
    for (const candidatePreview of [undefined, "", "0"]) {
      for (const effect of effects) {
        expect(() =>
          assertCandidateExternalEffectAllowed({
            effect,
            candidatePreview,
            supabaseUrls: ["https://sdmxtlgjkodidjtvikng.supabase.co"],
          }),
        ).toThrow(`candidate_preview_external_effect_forbidden:${effect}`);
      }
    }
  });

  it("blocks all audited external effects in a governance Preview even with inherited non-Candidate targets", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SF_GOV_CANDIDATE_PREVIEW", "0");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://hedouonyhynuvwbckdlg.supabase.co");
    vi.stubEnv("SUPABASE_URL", "https://hedouonyhynuvwbckdlg.supabase.co");
    for (const effect of effects) {
      expect(() => assertCandidateRuntimeExternalEffectAllowed(effect)).toThrow(
        `candidate_preview_external_effect_forbidden:${effect}`,
      );
    }
  });

  it("runtime checks both public and server Supabase destinations without a flag", () => {
    vi.stubEnv("SF_GOV_CANDIDATE_PREVIEW", "0");
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://hedouonyhynuvwbckdlg.supabase.co");
      vi.stubEnv("SUPABASE_URL", "https://hedouonyhynuvwbckdlg.supabase.co");
      vi.stubEnv(name, "https://sdmxtlgjkodidjtvikng.supabase.co");
      for (const effect of effects) {
        expect(() => assertCandidateRuntimeExternalEffectAllowed(effect)).toThrow();
      }
    }
  });

  it("preserves non-Candidate destinations with no Candidate flag", () => {
    for (const ref of ["hedouonyhynuvwbckdlg", "qfhojvgvhrbautvczffq"]) {
      expect(() =>
        assertCandidateExternalEffectAllowed({
          effect: "meta_whatsapp_send",
          supabaseUrls: [`https://${ref}.supabase.co`],
        }),
      ).not.toThrow();
    }
  });
});
