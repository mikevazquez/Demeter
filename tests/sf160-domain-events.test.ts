import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  claimDomainEvent,
  emitDomainEvent,
  type DomainEventRpcClient,
  type DomainEventRpcResult,
} from "@/lib/automations/domain-events";

class FakeDomainEventRpcClient implements DomainEventRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Record<string, unknown>;
  }> = [];

  private readonly eventIds = new Map<string, string>();
  private readonly claims = new Set<string>();
  private sequence = 0;

  async rpc<T>(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<DomainEventRpcResult<T>> {
    this.calls.push({ functionName, args });

    if (functionName === "emit_domain_event") {
      const identity = `${String(args.p_studio_id)}:${String(args.p_deduplication_key)}`;
      let eventId = this.eventIds.get(identity);
      if (!eventId) {
        this.sequence += 1;
        eventId = `event-${this.sequence}`;
        this.eventIds.set(identity, eventId);
      }
      return { data: eventId as unknown as T, error: null };
    }

    if (functionName === "claim_domain_event") {
      const claim = `${String(args.p_event_id)}:${String(args.p_consumer_key)}`;
      const isFirstClaim = !this.claims.has(claim);
      this.claims.add(claim);
      return { data: isFirstClaim as unknown as T, error: null };
    }

    return {
      data: null,
      error: { message: `unexpected_rpc:${functionName}` },
    };
  }
}

const baseEvent = {
  studioId: "11111111-1111-1111-1111-111111111111",
  eventType: "booking.confirmed",
  sourceEntityType: "booking",
  sourceEntityId: "22222222-2222-2222-2222-222222222222",
  deduplicationKey: "booking:22222222-2222-2222-2222-222222222222:confirmed",
  occurredAt: "2026-09-18T20:00:00.000Z",
  actorUserId: "33333333-3333-3333-3333-333333333333",
  payload: { reservationStatus: "reserved" },
};

describe("SF-160 domain events", () => {
  it("emits the standard provider-neutral envelope through the domain RPC", async () => {
    const client = new FakeDomainEventRpcClient();

    const eventId = await emitDomainEvent(client, baseEvent);

    expect(eventId).toBe("event-1");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      functionName: "emit_domain_event",
      args: {
        p_studio_id: baseEvent.studioId,
        p_event_type: baseEvent.eventType,
        p_source_entity_type: baseEvent.sourceEntityType,
        p_source_entity_id: baseEvent.sourceEntityId,
        p_deduplication_key: baseEvent.deduplicationKey,
        p_occurred_at: baseEvent.occurredAt,
        p_actor_user_id: baseEvent.actorUserId,
        p_payload: baseEvent.payload,
      },
    });
  });

  it(
    "keeps duplicate event identity stable inside a studio and isolated across studios",
    async () => {
      const client = new FakeDomainEventRpcClient();

      const first = await emitDomainEvent(client, baseEvent);
      const duplicate = await emitDomainEvent(client, baseEvent);
      const otherStudio = await emitDomainEvent(client, {
        ...baseEvent,
        studioId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      });

      expect(duplicate).toBe(first);
      expect(otherStudio).not.toBe(first);
    },
  );

  it("allows a consumer to claim a domain event only once", async () => {
    const client = new FakeDomainEventRpcClient();
    const eventId = await emitDomainEvent(client, baseEvent);

    await expect(
      claimDomainEvent(client, eventId, "automation.booking-confirmed"),
    ).resolves.toBe(true);
    await expect(
      claimDomainEvent(client, eventId, "automation.booking-confirmed"),
    ).resolves.toBe(false);
  });

  it("locks the database contract to append-only, tenant-aware idempotency", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260918204721_sf160_domain_events.sql"),
      "utf8",
    );
    const hardening = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260918204757_sf160_domain_events_index_hardening.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("domain_events_studio_dedup_unique");
    expect(migration).toContain("unique (studio_id, deduplication_key)");
    expect(migration).toContain("domain_events_immutable");
    expect(migration).toContain("domain_event_consumptions_immutable");
    expect(migration).toContain("on conflict (studio_id, deduplication_key) do nothing");
    expect(migration).toContain("primary key (event_id, consumer_key)");
    expect(migration).toContain("private.has_capability(studio_id, 'reports.read')");
    expect(migration).toContain("grant execute on function public.emit_domain_event");
    expect(migration).toContain("to service_role");
    expect(migration).not.toMatch(/asistian|whatsapp|webhook/i);
    expect(hardening).toContain("domain_event_consumptions_studio_event_idx");
  });
});
