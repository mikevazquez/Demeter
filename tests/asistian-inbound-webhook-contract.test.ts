import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Asistian -> Studio Flow receiver contract", () => {
  const receiver = source("supabase/functions/receive-asistian-webhook/index.ts");
  const migration = source(
    "supabase/migrations/20260923041000_asistian_inbound_receiver.sql",
  );

  it("verifies both current and compatibility HMAC signatures", () => {
    expect(receiver).toContain('request.headers.get("x-asistian-signature")');
    expect(receiver).toContain('request.headers.get("x-webhook-signature")');
    expect(receiver).toContain('parts.get("t")');
    expect(receiver).toContain('parts.get("v1")');
    expect(receiver).toContain('hmacSha256Hex(secret, rawBody)');
    expect(receiver).toContain('"x-webhook-signature-body"');
  });

  it("deduplicates the stable provider event id", () => {
    expect(receiver).toContain('request.headers.get("x-webhook-id")');
    expect(receiver).toContain('body.event_id');
    expect(receiver).toContain('insertError?.code === "23505"');
    expect(migration).toContain("unique (studio_id, provider_event_id)");
  });

  it("keeps captured customer payloads admin-only", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("private.has_capability(studio_id, 'settings.write')");
    expect(migration).toContain("grant select on table public.asistian_webhook_events to authenticated");
  });
});
