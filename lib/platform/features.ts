import type { SupabaseClient } from "@supabase/supabase-js";

// NEB-01-20 · Lanzamientos por estudio (migración 20261023164000_neb01_feature_releases).

export type FeatureStage = "sandbox" | "beta" | "all";

export const FEATURE_STAGE_LABEL: Record<FeatureStage, string> = {
  sandbox: "Sandbox",
  beta: "Beta",
  all: "Todos",
};

export const FEATURE_STAGES: FeatureStage[] = ["sandbox", "beta", "all"];

export type PlatformFeature = {
  key: string;
  name: string;
  description: string;
  stage: FeatureStage;
  stageChangedAt: string;
  betaStudios: string[];
};

export type FeatureNews = { key: string; name: string; description: string };

function stageOf(value: unknown): FeatureStage {
  return value === "beta" || value === "all" ? value : "sandbox";
}

/** Siguiente / anterior etapa (null si ya está en el extremo). */
export function nextStage(stage: FeatureStage): FeatureStage | null {
  return stage === "sandbox" ? "beta" : stage === "beta" ? "all" : null;
}

export function previousStage(stage: FeatureStage): FeatureStage | null {
  return stage === "all" ? "beta" : stage === "beta" ? "sandbox" : null;
}

export function parsePlatformFeatures(raw: unknown): {
  environment: "sandbox" | "production";
  features: PlatformFeature[];
} | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const features = Array.isArray(data.features)
    ? data.features.map((item) => {
        const f = (item ?? {}) as Record<string, unknown>;
        return {
          key: String(f.key ?? ""),
          name: String(f.name ?? ""),
          description: String(f.description ?? ""),
          stage: stageOf(f.stage),
          stageChangedAt: String(f.stage_changed_at ?? ""),
          betaStudios: Array.isArray(f.beta_studios) ? f.beta_studios.map(String) : [],
        };
      })
    : [];
  return { environment: data.environment === "sandbox" ? "sandbox" : "production", features };
}

export function parseFeatureNews(raw: unknown): FeatureNews[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const data = (item ?? {}) as Record<string, unknown>;
    return {
      key: String(data.key ?? ""),
      name: String(data.name ?? ""),
      description: String(data.description ?? ""),
    };
  });
}

/** Funciones encendidas en el estudio. Si la base no responde, ninguna (lo seguro). */
export async function loadStudioFeatureFlags(
  supabase: SupabaseClient,
  studioId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase.rpc("studio_feature_flags", { p_studio: studioId });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return new Set();
  return new Set(
    Object.entries(data as Record<string, unknown>)
      .filter(([, on]) => on === true)
      .map(([key]) => key),
  );
}
