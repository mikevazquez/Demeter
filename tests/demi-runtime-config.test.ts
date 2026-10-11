import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

function load() {
  const loaded = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(readFileSync("lib/assistant/runtime-config.ts", "utf8"), {
      loader: "ts",
      format: "cjs",
    }).code,
  )(
    (name: string) => {
      if (name === "server-only") return {};
      throw new Error(name);
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports as {
    loadDemiRuntimeConfig: (
      client: unknown,
      studioId: string,
    ) => Promise<{ data: unknown; error: unknown }>;
  };
}

describe("Demi runtime configuration", () => {
  function clientWithResults(results: Array<{ data: unknown; error: unknown }>) {
    const lookups: Array<Record<string, string>> = [];
    const client = {
      from: () => {
        const filters: Record<string, string> = {};
        const query = {
          select: () => query,
          eq: (key: string, value: string) => {
            filters[key] = value;
            return query;
          },
          maybeSingle: async () => {
            lookups.push(filters);
            return results[lookups.length - 1];
          },
        };
        return query;
      },
    };
    return { client, lookups };
  }

  it("supports the production schema without assistant_key and preserves studio isolation", async () => {
    const legacy = { data: { assistant_name: "Demi" }, error: null };
    const { client, lookups } = clientWithResults([
      {
        data: null,
        error: { code: "42703", message: "column assistant_configs.assistant_key does not exist" },
      },
      legacy,
    ]);
    expect(await load().loadDemiRuntimeConfig(client, "studio")).toEqual(legacy);
    expect(lookups).toEqual([
      { studio_id: "studio", assistant_key: "demi" },
      { studio_id: "studio" },
    ]);
  });

  it.each([
    { code: "42501", message: "permission denied" },
    { code: "PGRST116", message: "multiple rows" },
    { code: "42703", message: "column model does not exist" },
  ])("does not bypass errors: $code $message", async (error) => {
    const failure = { data: null, error };
    const { client, lookups } = clientWithResults([failure]);
    expect(await load().loadDemiRuntimeConfig(client, "studio")).toEqual(failure);
    expect(lookups).toHaveLength(1);
  });

  it("does not select Polina when Demi is missing", async () => {
    const result = { data: null, error: null };
    const { client, lookups } = clientWithResults([result]);
    expect(await load().loadDemiRuntimeConfig(client, "studio")).toEqual(result);
    expect(lookups).toHaveLength(1);
  });

  it("selects Demi when another assistant belongs to the same studio", async () => {
    const rows = [
      { studio_id: "studio", assistant_key: "demi", assistant_name: "Demi" },
      { studio_id: "studio", assistant_key: "polina", assistant_name: "Polina" },
      { studio_id: "other", assistant_key: "demi", assistant_name: "Other Demi" },
    ];
    const filters: Record<string, string> = {};
    const query = {
      select: () => query,
      eq: (key: string, value: string) => {
        filters[key] = value;
        return query;
      },
      maybeSingle: async () => {
        const matches = rows.filter((row) =>
          Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value),
        );
        return {
          data: matches.length === 1 ? matches[0] : null,
          error: matches.length > 1 ? "multiple_rows" : null,
        };
      },
    };
    const result = await load().loadDemiRuntimeConfig({ from: () => query }, "studio");
    expect(result.error).toBeNull();
    expect(result.data).toEqual(rows[0]);
  });
});
