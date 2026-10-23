import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  loadStudioFeatureFlags,
  nextStage,
  parseFeatureNews,
  parsePlatformFeatures,
  previousStage,
} from "@/lib/platform/features";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261023164000_neb01_feature_releases.sql");

describe("NEB-01-20 lanzamientos", () => {
  it("avanza y regresa de etapa en orden", () => {
    expect(nextStage("sandbox")).toBe("beta");
    expect(nextStage("beta")).toBe("all");
    expect(nextStage("all")).toBeNull();
    expect(previousStage("all")).toBe("beta");
    expect(previousStage("sandbox")).toBeNull();
  });

  it("lee el catálogo y las novedades", () => {
    const catalog = parsePlatformFeatures({
      environment: "sandbox",
      features: [{ key: "x_y", name: "X", stage: "beta", beta_studios: ["s1"] }],
    });
    expect(catalog?.environment).toBe("sandbox");
    expect(catalog?.features[0]).toMatchObject({ key: "x_y", stage: "beta", betaStudios: ["s1"] });
    expect(parsePlatformFeatures(null)).toBeNull();
    expect(parseFeatureNews([{ key: "x_y", name: "X" }])[0].name).toBe("X");
  });

  it("si la base falla no enciende nada", async () => {
    const failing = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    expect((await loadStudioFeatureFlags(failing as never, "s1")).size).toBe(0);
    const ok = { rpc: async () => ({ data: { config_review: true, otra: false }, error: null }) };
    expect([...(await loadStudioFeatureFlags(ok as never, "s1"))]).toEqual(["config_review"]);
  });

  it("liberar a todos exige confirmación y producción es el valor por defecto", () => {
    expect(migration).toContain("raise exception 'feature_confirm_required'");
    expect(migration).toContain("'production')");
    expect(migration).toContain("perform private.platform_require_admin();");
    expect(migration).toContain(
      "revoke all on function public.platform_set_feature_stage(text, text, boolean) from public, anon;",
    );
    expect(migration).toContain("('config_review'");
    expect(migration).toContain("('support_requests'");
  });
});
