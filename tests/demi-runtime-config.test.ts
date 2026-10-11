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
