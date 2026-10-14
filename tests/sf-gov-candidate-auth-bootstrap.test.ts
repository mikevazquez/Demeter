import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { B02_FIXTURE_EMAIL, candidateAuthBootstrap } from "../scripts/candidate-auth-bootstrap";

const nonce = "a".repeat(64);
const timestamp = 1_800_000_000_000;

function fixture(overrides = {}) {
  const createUser = vi.fn(
    async (input: {
      email: string;
    }): Promise<{ data: { user: { id: string; email: string } | null }; error: unknown }> => ({
      data: { user: { id: "synthetic-uuid", email: input.email } },
      error: null,
    }),
  );
  const admin = vi.fn(() => ({ createUser }));
  const handler = candidateAuthBootstrap({
    supabaseUrl: "https://sdmxtlgjkodidjtvikng.supabase.co",
    nonceSha256: createHash("sha256").update(nonce).digest("hex"),
    issuedAtMs: timestamp,
    expiresAtMs: timestamp + 600_000,
    sourceSha: "b".repeat(40),
    now: () => timestamp + 1,
    admin,
    ...overrides,
  });
  const request = (body: unknown = { password: "p".repeat(48) }, secret = nonce) =>
    new Request("https://candidate.invalid/bootstrap", {
      method: "POST",
      headers: { "x-sf-gov-bootstrap-nonce": secret },
      body: JSON.stringify(body),
    });
  return { handler, request, admin, createUser };
}

describe("B02 bounded Candidate Auth bootstrap", () => {
  it("rejects missing nonce and non-POST requests without creating a client", async () => {
    const f = fixture();
    expect((await f.handler(f.request(undefined, ""))).status).toBe(403);
    expect((await f.handler(new Request("https://candidate.invalid/bootstrap"))).status).toBe(405);
    expect(f.admin).not.toHaveBeenCalled();
  });
  it("rechecks expiry after body parsing before using admin privileges", async () => {
    const now = vi
      .fn()
      .mockReturnValueOnce(timestamp + 1)
      .mockReturnValueOnce(timestamp + 600_000);
    const f = fixture({ now });
    expect((await f.handler(f.request())).status).toBe(403);
    expect(f.admin).not.toHaveBeenCalled();
  });
  it("creates only the fixed unprivileged .invalid fixture through confirmed-email Admin API", async () => {
    const f = fixture();
    const result = await f.handler(f.request());
    expect(result.status).toBe(201);
    expect(f.createUser).toHaveBeenCalledOnce();
    const input = f.createUser.mock.calls[0][0];
    expect(input).toMatchObject({
      email: B02_FIXTURE_EMAIL,
      email_confirm: true,
      app_metadata: { synthetic: true, fixture: "SF-GOV-001-B02-DIAGNOSTIC" },
    });
    expect(input).not.toHaveProperty("phone");
    expect(input).not.toHaveProperty("role");
    expect(JSON.stringify(await result.json())).not.toContain("p".repeat(48));
  });
  it.each([
    "https://qfhojvgvhrbautvczffq.supabase.co",
    "https://hedouonyhynuvwbckdlg.supabase.co",
    "not-url",
    "https://user@sdmxtlgjkodidjtvikng.supabase.co",
  ])("denies target %s before creating an admin client", async (supabaseUrl) => {
    const f = fixture({ supabaseUrl });
    expect((await f.handler(f.request())).status).toBe(503);
    expect(f.admin).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { now: () => timestamp + 600_000 },
    { now: () => timestamp - 1 },
    { expiresAtMs: timestamp + 600_001 },
    { sourceSha: "invalid" },
    { nonceSha256: "invalid" },
  ])("denies unauthorized or invalid installation %j", async (options) => {
    const f = fixture(options);
    const r = await f.handler(
      f.request(undefined, Object.keys(options).length ? nonce : "b".repeat(64)),
    );
    expect(r.status).toBe(403);
    expect(f.admin).not.toHaveBeenCalled();
  });
  it.each([
    { password: "p".repeat(48), email: "real@example.com" },
    { password: "p".repeat(48), role: "admin" },
    { password: "short" },
    { password: "p".repeat(129) },
    {},
    [],
  ])("rejects arbitrary account or privilege input %j", async (body) => {
    const f = fixture();
    expect((await f.handler(f.request(body))).status).toBe(400);
    expect(f.admin).not.toHaveBeenCalled();
  });
  it("does not reveal internal errors or attempt a password reset when the identity exists", async () => {
    const f = fixture();
    f.createUser.mockResolvedValueOnce({
      data: { user: null } as never,
      error: new Error("sensitive-test-detail") as never,
    });
    const result = await f.handler(f.request());
    expect(result.status).toBe(409);
    expect(await result.text()).not.toContain("sensitive-test-detail");
    expect(f.createUser).toHaveBeenCalledOnce();
  });
});
