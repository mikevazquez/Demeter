import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

// Execute the deployed Deno source with the real installed Supabase SDK.
// Only npm: module loading, env access and the HTTP boundary are supplied here.
function loadAuth() {
  const source = readFileSync("supabase/functions/_shared/stripe-billing.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", "Deno", compiled)(
    (name: string) => {
      if (name.startsWith("npm:@supabase/supabase-js")) return { createClient };
      if (name.startsWith("npm:stripe")) return { default: class Stripe {} };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    exports,
    {
      env: {
        get: (name: string) =>
          ({ SUPABASE_URL: "https://sandbox.example.test", SUPABASE_ANON_KEY: "anon-test" })[
            name as "SUPABASE_URL" | "SUPABASE_ANON_KEY"
          ],
      },
    },
  );
  return exports.getAuthenticatedUser as (
    request: Request,
  ) => Promise<{ user: { id: string } | null; error: string | null }>;
}

afterEach(() => vi.unstubAllGlobals());

describe("Stripe Edge Function user authentication", () => {
  it("sends exactly the caller bearer token to Auth, without a duplicate anon header", async () => {
    const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
      const authorization = new Headers(init.headers).get("authorization");
      if (authorization !== "Bearer caller-token") {
        return new Response(JSON.stringify({ msg: "Invalid JWT", code: "bad_jwt" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ id: "owner-id" }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await loadAuth()(
      new Request("https://edge.example.test", {
        headers: { Authorization: "Bearer caller-token" },
      }),
    );
    expect(result.user?.id).toBe("owner-id");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([undefined, "Basic caller-token", "Bearer "])(
    "rejects missing or malformed credentials (%s) before contacting Auth",
    async (authorization) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      const result = await loadAuth()(
        new Request("https://edge.example.test", {
          headers: authorization ? { Authorization: authorization } : {},
        }),
      );
      expect(result.user).toBeNull();
      expect(result.error).toBe("unauthenticated");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("does not accept a user when Auth rejects an expired or invalid token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ msg: "Expired JWT" }), { status: 401 })),
    );
    const result = await loadAuth()(
      new Request("https://edge.example.test", { headers: { Authorization: "Bearer expired" } }),
    );
    expect(result.user).toBeNull();
    expect(result.error).toBe("unauthenticated");
  });
});
