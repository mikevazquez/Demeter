import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DemiTurnCoordinator, type ClaimRpc } from "../lib/assistant/demi-text-send-claim";

const exec = promisify(execFile);
const container = `demi378-test-${process.pid}`;
const enabled = process.env.DEMI378_PG_TESTS === "1";
const owners: DemiTurnCoordinator[] = [];
const literal = (v: unknown) =>
  v === null
    ? "null"
    : `'${(typeof v === "object" ? JSON.stringify(v) : String(v)).replaceAll("'", "''")}'`;
async function sql(query: string) {
  const r = await exec("docker", [
    "--host=unix:///var/run/docker.sock",
    "exec",
    container,
    "psql",
    "-h",
    "127.0.0.1",
    "-U",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-Atq",
    "-c",
    query,
  ]);
  return r.stdout.trim();
}
const rpc: ClaimRpc = async (name, args) => {
  try {
    const value = await sql(
      `set request.jwt.claim.role='service_role'; select to_jsonb(public.${name}(${Object.entries(
        args,
      )
        .map(([key, value]) => `${key} => ${literal(value)}`)
        .join(",")}));`,
    );
    return { data: JSON.parse(value), error: null };
  } catch (error) {
    return { data: null, error };
  }
};
async function event(
  studio: string,
  contact = "529990003780",
  messageType = "text",
  id = randomUUID(),
  providerId = randomUUID(),
) {
  await sql(
    `insert into assistant_whatsapp_events(id,studio_id,provider_event_id,phone_number_id,contact_wa_id,message_type,payload_fingerprint) values (${literal(id)},${literal(studio)},${literal(providerId)},'synthetic',${literal(contact)},${literal(messageType)},'synthetic') on conflict do nothing;`,
  );
  return id;
}
function coordinator(studio: string, id: string, transport: ClaimRpc = rpc) {
  const owner = new DemiTurnCoordinator(transport, studio, id);
  owners.push(owner);
  return owner;
}
const accepted = () =>
  Promise.resolve({
    status: "accepted" as const,
    providerMessageId: `uat:${randomUUID()}`,
    httpStatus: 200,
    responseSnapshot: { accepted: true },
  });
async function claimState(studio: string) {
  return sql(
    `select state from assistant_whatsapp_send_claims where studio_id=${literal(studio)} order by id desc limit 1;`,
  );
}

// Opt-in: actual PostgreSQL 17 row locks and independent sessions, no remote credentials.
describe.runIf(enabled)("DEMI-378 PostgreSQL concurrency and simulated Meta", () => {
  beforeAll(async () => {
    await exec("docker", [
      "--host=unix:///var/run/docker.sock",
      "run",
      "--name",
      container,
      "-e",
      "POSTGRES_PASSWORD=synthetic-local-only",
      "-d",
      "postgres:17",
    ]);
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        await sql("select 1;");
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!ready) throw new Error("PostgreSQL did not start");
    await sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
      create table public.assistant_whatsapp_events (
        id uuid primary key default gen_random_uuid(), studio_id uuid not null,
        provider text not null default 'meta_whatsapp', provider_event_id text not null,
        phone_number_id text not null, contact_wa_id text, message_type text not null,
        body_preview text, provider_timestamp timestamptz, payload_fingerprint text not null,
        processing_status text not null default 'captured', processing_result jsonb default '{}',
        received_at timestamptz not null default clock_timestamp(), inbound_turn_id uuid,
        unique(studio_id,provider,provider_event_id));
      grant usage on schema public,auth to service_role;
      grant execute on function auth.role() to service_role;`);
    await sql(
      readFileSync("supabase/migrations/20261023183000_demi378_atomic_send_claims.sql", "utf8"),
    );
  }, 60_000);
  afterEach(async () => {
    await Promise.all(owners.splice(0).map((o) => o.release()));
  });
  afterAll(async () => {
    await exec("docker", ["--host=unix:///var/run/docker.sock", "rm", "-f", container]);
  });

  it("C01 consolidates consecutive texts, including equal received_at", async () => {
    const studio = randomUUID();
    const a = await event(studio);
    const b = await event(studio);
    await sql(
      `update assistant_whatsapp_events set received_at='2026-10-23T00:00Z' where studio_id=${literal(studio)};`,
    );
    const first = coordinator(studio, a);
    expect(await first.acquire()).toBe("owned");
    expect(await first.current()).toBe(false);
    await expect(first.authorizeSend()).rejects.toThrow("text_claim_stale");
    await first.release();
    const last = coordinator(studio, b);
    expect(await last.acquire()).toBe("owned");
    const send = vi.fn(accepted);
    await last.send(send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("C02 invalidates generation while a deferred model is running", async () => {
    const studio = randomUUID();
    const first = coordinator(studio, await event(studio));
    await first.acquire();
    const nextId = await event(studio);
    const next = coordinator(studio, nextId);
    expect(await next.acquire()).toBe("busy");
    expect(await first.current()).toBe(false);
    await expect(first.send(accepted)).rejects.toThrow("stale");
    await first.release();
    expect(await next.acquire()).toBe("owned");
    expect(await next.current()).toBe(true);
    await next.send(accepted);
    expect(await claimState(studio)).toBe("accepted");
  });

  it("C03 cancels a reserved response when capture commits before authorization", async () => {
    const studio = randomUUID();
    const id = await event(studio);
    const owner = coordinator(studio, id);
    await owner.acquire();
    expect(
      (
        await rpc("assistant_whatsapp_claim_current_text", {
          p_studio_id: studio,
          p_event_id: id,
          p_claim_token: owner.token,
        })
      ).data,
    ).toBe(true);
    await event(studio);
    expect(
      (
        await rpc("assistant_whatsapp_authorize_text_send", {
          p_studio_id: studio,
          p_event_id: id,
          p_claim_token: owner.token,
        })
      ).data,
    ).toBe(false);
    expect(await claimState(studio)).toBe("invalidated");
  });

  it("C04 admits one owner across twelve independent PostgreSQL sessions", async () => {
    const studio = randomUUID();
    const id = await event(studio);
    const workers = Array.from({ length: 12 }, () => coordinator(studio, id));
    const statuses = await Promise.all(workers.map((w) => w.acquire()));
    expect(statuses.filter((s) => s === "owned")).toHaveLength(1);
    expect(statuses.filter((s) => s === "busy")).toHaveLength(11);
    const send = vi.fn(accepted);
    await workers[statuses.indexOf("owned")].send(send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("C05 webhook replay does not advance the generation or reopen an accepted send", async () => {
    const studio = randomUUID();
    const providerId = randomUUID();
    const id = await event(studio, undefined, undefined, undefined, providerId);
    const worker = coordinator(studio, id);
    await worker.acquire();
    await worker.send(accepted);
    await worker.release();
    await event(studio, undefined, undefined, randomUUID(), providerId);
    expect(
      await sql(
        `select generation from assistant_whatsapp_turn_owners where studio_id=${literal(studio)}`,
      ),
    ).toBe("1");
    expect(await coordinator(studio, id).acquire()).toBe("sealed");
  });

  it("C06 database failure prevents provider calls", async () => {
    const studio = randomUUID();
    const id = await event(studio);
    const owner = coordinator(studio, id);
    await owner.acquire();
    const unavailable: ClaimRpc = async () => ({ data: null, error: { code: "offline" } });
    const broken = coordinator(studio, id, unavailable);
    const send = vi.fn(accepted);
    await expect(broken.send(send)).rejects.toThrow("unavailable");
    expect(send).not.toHaveBeenCalled();
  });

  it("C07 network uncertainty is sealed while a subsequent new event remains usable", async () => {
    const studio = randomUUID();
    const id = await event(studio);
    const owner = coordinator(studio, id);
    await owner.acquire();
    const send = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(owner.send(send)).rejects.toThrow("uncertain");
    expect(await claimState(studio)).toBe("uncertain");
    await owner.release();
    expect(await coordinator(studio, id).acquire()).toBe("sealed");
    const next = coordinator(studio, await event(studio));
    expect(await next.acquire()).toBe("owned");
    await next.send(accepted);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("C08 accepted Meta plus failed receipt persistence never reopens dispatch", async () => {
    const studio = randomUUID();
    const id = await event(studio);
    const broken: ClaimRpc = (name, args) =>
      name === "assistant_whatsapp_finish_text_claim"
        ? Promise.resolve({ data: null, error: { code: "offline" } })
        : rpc(name, args);
    const owner = coordinator(studio, id, broken);
    await owner.acquire();
    const send = vi.fn(accepted);
    await expect(owner.send(send)).rejects.toThrow("requires_review");
    await owner.release();
    expect(await coordinator(studio, id).acquire()).toBe("sealed");
    expect(await claimState(studio)).toBe("uncertain");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("C09 recovers an abandoned pre-send lease and fences the old token", async () => {
    const studio = randomUUID();
    const id = await event(studio);
    const old = coordinator(studio, id);
    await old.acquire();
    await sql(
      `update assistant_whatsapp_events set processing_status='processing' where id=${literal(id)}; update assistant_whatsapp_turn_owners set owner_until=clock_timestamp()-interval '1 second' where studio_id=${literal(studio)}`,
    );
    const recovered = coordinator(studio, id);
    expect(await recovered.acquire()).toBe("owned");
    expect(await old.current()).toBe(false);
    await expect(old.send(accepted)).rejects.toThrow("stale");
    await recovered.send(accepted);
    expect(await claimState(studio)).toBe("accepted");
  });

  it("C10 replays the action receipt without executing a simulated reservation/payment twice", async () => {
    const studio = randomUUID();
    const id = await event(studio);
    const owner = coordinator(studio, id);
    await owner.acquire();
    const effect = vi.fn(async () => ({
      ok: true,
      reservation_id: randomUUID(),
      payment_id: randomUUID(),
    }));
    const result = await owner.action("commercial", { b: 2, a: 1 }, effect);
    expect(await owner.action("commercial", { a: 1, b: 2 }, effect)).toEqual(result);
    expect(effect).toHaveBeenCalledTimes(1);
    const ambiguous = vi.fn(async () => {
      throw new Error("connection lost after effect");
    });
    await expect(owner.action("other_effect", {}, ambiguous)).rejects.toThrow();
    await expect(owner.action("other_effect", {}, ambiguous)).rejects.toThrow("requires_review");
    expect(ambiguous).toHaveBeenCalledTimes(1);
    await event(studio);
    await owner.release();
    const nextId = await event(studio);
    const next = coordinator(studio, nextId);
    await next.acquire();
    await expect(next.action("other_effect", {}, ambiguous)).rejects.toThrow("requires_review");
    expect(ambiguous).toHaveBeenCalledTimes(1);
  });

  it("preserves nontext events, normalizes Mexican identity and isolates tenants", async () => {
    const studio = randomUUID();
    const textId = await event(studio, "5219990003780");
    await event(studio, "529990003780", "image");
    const owner = coordinator(studio, textId);
    expect(await owner.acquire()).toBe("owned");
    expect(await owner.current()).toBe(true);
    const other = coordinator(randomUUID(), textId);
    expect(await other.acquire()).toBe("missing");
    expect(
      await sql(
        `select count(*) from assistant_whatsapp_turn_owners where studio_id=${literal(studio)}`,
      ),
    ).toBe("1");
  });

  it("denies public/anonymous/authenticated calls and direct service-role mutation", async () => {
    const rows = await sql(
      `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'assistant_whatsapp_%' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'));`,
    );
    expect(rows).toBe("0");
    expect(
      await sql(
        "select has_table_privilege('service_role','assistant_whatsapp_send_claims','insert');",
      ),
    ).toBe("f");
    await expect(
      sql(
        "set role authenticated; select public.assistant_whatsapp_coordinate(null,null,null,'acquire');",
      ),
    ).rejects.toThrow();
  });
});
