import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

function harness(
  options: {
    tokenValid?: boolean;
    scopeError?: boolean;
    failDelivery?: boolean;
    revalidate?: boolean;
  } = {},
) {
  let handler: (request: Request) => Promise<Response>;
  const rpc = vi.fn(async (name: string) => {
    const data =
      name === "verify_automation_dispatch_token"
        ? options.tokenValid === true
        : name === "service_claim_demi_followups"
          ? [{ id: "job", lease_token: "lease", kind: "prospect", step: 1, attempt_count: 1 }]
          : name === "service_revalidate_demi_followup"
            ? { eligible: options.revalidate !== false, reason_code: "contact_replied" }
            : name === "service_capture_demi_uat_delivery"
              ? { failed: options.failDelivery === true, artifact_id: "capture" }
              : name === "service_finish_demi_followup"
                ? { ok: true, status: "accepted" }
                : 0;
    return { data, error: null };
  });
  const chain = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({
      data: { id: "run" },
      error: options.scopeError ? { message: "failure" } : null,
    }),
  };
  const client = { rpc, from: () => chain };
  const source = readFileSync("supabase/functions/demi-followup-worker/index.ts", "utf8");
  new Function("require", "Deno", transformSync(source, { loader: "ts", format: "cjs" }).code)(
    (name: string) => {
      if (name !== "npm:@supabase/supabase-js@2.116.0") throw new Error(name);
      return { createClient: () => client };
    },
    {
      env: {
        get: (key: string) =>
          key === "SUPABASE_SERVICE_ROLE_KEY"
            ? "test-service"
            : "https://hedouonyhynuvwbckdlg.supabase.co",
      },
      serve: (fn: typeof handler) => {
        handler = fn;
      },
    },
  );
  const request = (headers: Record<string, string> = { authorization: "Bearer test-service" }) =>
    handler(
      new Request("https://worker.test", {
        method: "POST",
        headers,
        body: JSON.stringify({
          studio_id: "11111111-1111-4111-8111-111111111111",
          as_of: "2026-10-10T12:00:00Z",
        }),
      }),
    );
  return { rpc, request };
}
describe("Demi followup worker", () => {
  it("rejects unauthenticated requests before reading tenant data", async () => {
    const h = harness();
    expect((await h.request({})).status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid dispatcher tokens", async () => {
    const h = harness();
    expect((await h.request({ "x-studio-flow-dispatch-token": "invalid" })).status).toBe(403);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
  it("accepts verified dispatcher tokens and captures synthetic output", async () => {
    const h = harness({ tokenValid: true });
    const response = await h.request({ "x-studio-flow-dispatch-token": "valid" });
    expect(response.status).toBe(200);
    expect((await response.json()).transport).toBe("captured");
    expect(h.rpc).toHaveBeenCalledWith(
      "service_finish_demi_followup",
      expect.objectContaining({ p_accepted: true, p_provider: "uat:capture" }),
    );
  });
  it("records an injected failure through the persisted retry engine", async () => {
    const h = harness({ failDelivery: true });
    expect((await h.request()).status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith(
      "service_finish_demi_followup",
      expect.objectContaining({ p_accepted: false, p_error: "demi_uat_injected_delivery_failure" }),
    );
  });
  it("does not send when revalidation detects a reply", async () => {
    const h = harness({ revalidate: false });
    expect((await h.request()).status).toBe(200);
    expect(h.rpc.mock.calls.some(([name]) => name === "service_capture_demi_uat_delivery")).toBe(
      false,
    );
  });
  it("fails closed when the synthetic scope cannot be established", async () => {
    const h = harness({ scopeError: true });
    expect((await h.request()).status).toBe(500);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
