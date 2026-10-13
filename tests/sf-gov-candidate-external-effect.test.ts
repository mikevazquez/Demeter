import { describe, expect, it } from "vitest";

import {
  assertCandidateExternalEffectAllowed,
  type CandidateExternalEffect,
} from "@/lib/assistant/external-effect-policy";

const effects: CandidateExternalEffect[] = [
  "meta_whatsapp_send",
  "meta_inbox_send",
  "openai_responses",
  "openai_transcription",
];

describe("SF-GOV-001 Candidate external effect isolation", () => {
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
});
