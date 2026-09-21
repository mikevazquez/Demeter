import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-174 reservation_confirmed Asistian routing", () => {
  const processor = source("supabase/functions/process-booking-created/index.ts");

  it("uses the shared Asistian transport instead of the mock provider", () => {
    expect(processor).toContain(
      'import { sendAsistianWebhook } from "../_shared/asistian-messaging.ts"',
    );
    expect(processor).toContain("await sendAsistianWebhook({");
    expect(processor).toContain('p_provider_key: "asistian"');
    expect(processor).toContain('provider: "asistian"');
    expect(processor).not.toContain("new MockMessagingProvider()");
  });

  it("routes reservation confirmations with the canonical template and event id", () => {
    expect(processor).toContain("template: RESERVATION_CONFIRMED_TEMPLATE");
    expect(processor).toContain("eventId: contextData.event.event_id");
    expect(processor).toContain("recipient: providerInput.recipient");
    expect(processor).toContain("variables,");
  });

  it("excludes waitlist promotions from the generic reservation confirmation", () => {
    const exclusion = processor.indexOf('if (eventSource === "waitlist")');
    const executionLookup = processor.indexOf("let execution = await existingExecution");

    expect(exclusion).toBeGreaterThan(-1);
    expect(executionLookup).toBeGreaterThan(-1);
    expect(exclusion).toBeLessThan(executionLookup);
    expect(processor).toContain('reason: "waitlist_routed_separately"');
  });

  it("keeps missing webhook configuration retryable instead of losing the event", () => {
    expect(processor).toContain(
      'providerResult.status === "skipped" ? true : providerResult.retryable',
    );
    expect(processor).toContain("if (!retryable)");
  });
});
