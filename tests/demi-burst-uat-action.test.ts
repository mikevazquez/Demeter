import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), service: vi.fn(), receiver: vi.fn() }));
vi.mock("../lib/auth/admin-context", () => ({ getAdminContext: mocks.admin }));
vi.mock("../lib/supabase/service", () => ({ createServiceClient: mocks.service }));
vi.mock("../app/api/integrations/meta-whatsapp/webhook/route", () => ({ POST: mocks.receiver }));
vi.mock("../app/api/integrations/meta-inbox/webhook/route", () => ({ POST: vi.fn() }));
import {
  runDemiUatBurst,
  getDemiUatRun,
  getDemiUatArtifactBatch,
} from "../app/admin/mas/demi/uat/actions";
import { demiUatScope } from "../lib/assistant/uat-scope";

const run = {
  id: "owned-run",
  studio_id: "isolated-child",
  source_studio_id: "source",
  owner_id: "admin",
  fixtures: {
    people: { prospect: { wa_id: "529990000001" }, student_active: { wa_id: "529990000008" } },
  },
};
let missingRun = false;
let busyRun = false;
let records: Array<{ kind: string; payload: Record<string, unknown> }>;
let filters: Array<[string, unknown]>;
let released: boolean;
let artifactRows: Array<Record<string, unknown>>;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://hedouonyhynuvwbckdlg.supabase.co");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("DEMI_PILOT_FORWARD_URL", "");
  vi.stubEnv("DEMI_PILOT_FORWARD_WA_IDS", "");
  missingRun = false;
  busyRun = false;
  released = false;
  records = [];
  artifactRows = [];
  filters = [];
  mocks.admin.mockResolvedValue({ studio: { id: "source" }, user: { id: "admin" } });
  const db = {
    rpc: vi.fn(async () => ({ data: !busyRun, error: null })),
    from(table: string) {
      const result = () => ({
        data:
          table === "demi_uat_runs"
            ? missingRun
              ? null
              : run
            : table === "demi_uat_artifacts"
              ? artifactRows
              : [],
        error: null,
      });
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        in: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        limit: () => query,
        order: () => query,
        single: async () => result(),
        update: () => {
          released = true;
          return query;
        },
        insert: async (row: { kind: string; payload: Record<string, unknown> }) => {
          records.push(row);
          return { error: null };
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  };
  mocks.service.mockReturnValue(db);
  mocks.receiver.mockImplementation(async (request: Request) => {
    const scope = demiUatScope()!;
    expect(scope.studioId).toBe("isolated-child");
    expect(scope.config.accessToken).toBe("uat-capture-only");
    const body = await request.text();
    const signature = `sha256=${createHmac("sha256", scope.config.appSecret).update(body).digest("hex")}`;
    expect(request.headers.get("x-hub-signature-256")).toBe(signature);
    expect(JSON.parse(body).entry[0].changes[0].value.messages).toHaveLength(3);
    return Response.json({ ok: true });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("authenticated burst UAT harness", () => {
  it("bounds normal responses while keeping full owned evidence separately downloadable", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const payload = {
      before: { historical: "x".repeat(5_000_000) },
      after: {},
      result: { ok: true },
    };
    artifactRows = [
      {
        id,
        kind: "human_control",
        created_at: "2026-10-23T00:00:00Z",
        payload,
        result: payload.result,
      },
    ];
    const current = await getDemiUatRun("owned-run");
    expect(JSON.stringify(current).length).toBeLessThan(10000);
    expect(current.artifacts[0].payload).toMatchObject({
      full_artifact_id: id,
      result: { ok: true },
    });
    expect((await getDemiUatArtifactBatch("owned-run", [id]))[0].payload).toEqual(payload);
    expect(filters).toContainEqual(["owner_id", "admin"]);
    expect(filters).toContainEqual(["source_studio_id", "source"]);
    expect(filters).toContainEqual(["run_id", "owned-run"]);
    expect(records).toEqual([]);
  });
  it("denies evidence from another owner and invalid or oversized batches", async () => {
    missingRun = true;
    await expect(
      getDemiUatArtifactBatch("other-run", ["11111111-1111-4111-8111-111111111111"]),
    ).rejects.toThrow("demi_uat_run_not_found");
    missingRun = false;
    await expect(getDemiUatArtifactBatch("owned-run", ["invalid"])).rejects.toThrow(
      "demi_uat_artifact_batch_invalid",
    );
    await expect(
      getDemiUatArtifactBatch("owned-run", Array(4).fill("11111111-1111-4111-8111-111111111111")),
    ).rejects.toThrow("demi_uat_artifact_batch_invalid");
  });
  it("executes signed messages only within the owned child capture scope and records evidence", async () => {
    await runDemiUatBurst("owned-run", "same_payload");
    expect(filters).toContainEqual(["owner_id", "admin"]);
    expect(filters).toContainEqual(["source_studio_id", "source"]);
    expect(records.map((r) => r.kind)).toEqual(["before_burst", "after_burst"]);
    expect(records[1].payload).toMatchObject({ transport: "capture_only", failure: null });
    expect(released).toBe(true);
    expect(demiUatScope()).toBeNull();
  });
  it("denies production, missing ownership, busy leases, arbitrary cases and pilot forwarding", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(runDemiUatBurst("owned-run", "burst")).rejects.toThrow();
    vi.stubEnv("VERCEL_ENV", "preview");
    missingRun = true;
    await expect(runDemiUatBurst("other-run", "burst")).rejects.toThrow("demi_uat_run_not_found");
    missingRun = false;
    busyRun = true;
    await expect(runDemiUatBurst("owned-run", "burst")).rejects.toThrow("demi_uat_run_busy");
    busyRun = false;
    await expect(runDemiUatBurst("owned-run", "external_url")).rejects.toThrow(
      "demi_uat_burst_scenario_invalid",
    );
    vi.stubEnv("DEMI_PILOT_FORWARD_URL", "https://example.invalid");
    await expect(runDemiUatBurst("owned-run", "burst")).rejects.toThrow(
      "demi_uat_burst_forwarding_configured",
    );
    expect(mocks.receiver).not.toHaveBeenCalled();
  });
  it("preserves receiver failure evidence and releases the lease", async () => {
    mocks.receiver.mockRejectedValueOnce(new Error("receiver_failure"));
    await expect(runDemiUatBurst("owned-run", "same_payload")).rejects.toThrow("receiver_failure");
    expect(records[1].payload.failure).toBe("receiver_failure");
    expect(released).toBe(true);
  });
});
