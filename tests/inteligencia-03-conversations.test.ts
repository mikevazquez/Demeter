import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-03 conversation intelligence", () => {
  const migration = source(
    "supabase/migrations/20260926121500_inteligencia03_conversations.sql",
  );
  const receiver = source("supabase/functions/receive-asistian-webhook/index.ts");
  const intelligence = source("app/admin/inteligencia/page.tsx");
  const integrationPage = source("app/admin/integraciones/asistian/page.tsx");

  it("stores generic CRM conversation windows with tenant-scoped RLS", () => {
    expect(migration).toContain("create table if not exists public.crm_conversations");
    expect(migration).toContain("alter table public.crm_conversations enable row level security");
    expect(migration).toContain("crm_conversations_reports_read");
    expect(migration).toContain("private.has_capability(studio_id, 'reports.read')");
  });

  it("groups Asistian activity into anchored 24-hour windows", () => {
    expect(migration).toContain("service_record_asistian_conversation_activity");
    expect(migration).toContain("v_activity_at < c.started_at + interval '24 hours'");
    expect(migration).toContain("'conversation.started'");
    expect(migration).toContain("'conversation.started:' || v_conversation_id::text");
  });

  it("links historical conversations when the contact later books", () => {
    expect(migration).toContain("link_asistian_conversations_from_booking");
    expect(migration).toContain("inteligencia03_link_conversations_after_asistian_booking");
    expect(migration).toContain("provider_contact_id = coalesce(c.provider_contact_id, new.asistian_client_id)");
  });

  it("accepts the custom conversation_activity contract in the signed receiver", () => {
    expect(receiver).toContain('"conversation_activity"');
    expect(receiver).toContain('"service_record_asistian_conversation_activity"');
    expect(receiver).toContain('"conversation_created"');
    expect(receiver).toContain('"conversation_updated"');
  });

  it("renders a conversation-to-student funnel without inflating repeated contacts", () => {
    expect(intelligence).toContain('.from("crm_conversations")');
    expect(intelligence).toContain("conversationIdentity");
    expect(intelligence).toContain("conversationCohortStats");
    expect(intelligence).toContain('label="Contacto → reserva"');
    expect(intelligence).toContain('title="💬 Embudo desde conversación"');
    expect(intelligence).toContain('title="📣 Origen de conversaciones"');
  });

  it("documents the webhook contract in Asistian settings", () => {
    expect(integrationPage).toContain("Capturar conversaciones entrantes");
    expect(integrationPage).toContain("conversation_activity");
    expect(integrationPage).toContain("ventanas de 24 horas");
  });
});
