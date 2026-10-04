import "server-only";

export type ModelPrice = {
  model: string;
  effectiveAt: string;
  inputUsdMicrosPerMillion: number;
  cachedInputUsdMicrosPerMillion: number;
  outputUsdMicrosPerMillion: number;
};

// Snapshot from OpenAI model documentation reviewed 2026-09-30.
// Keep dated: pricing must not be treated as permanent.
const MODEL_PRICES: ModelPrice[] = [
  {
    model: "gpt-5.6-luna",
    effectiveAt: "2026-07-30",
    inputUsdMicrosPerMillion: 200_000,
    cachedInputUsdMicrosPerMillion: 20_000,
    outputUsdMicrosPerMillion: 1_200_000,
  },
  {
    model: "gpt-5.6-terra",
    effectiveAt: "2026-07-30",
    inputUsdMicrosPerMillion: 2_000_000,
    cachedInputUsdMicrosPerMillion: 200_000,
    outputUsdMicrosPerMillion: 12_000_000,
  },
  {
    model: "gpt-5.6-sol",
    effectiveAt: "2026-07-30",
    inputUsdMicrosPerMillion: 4_000_000,
    cachedInputUsdMicrosPerMillion: 400_000,
    outputUsdMicrosPerMillion: 20_000_000,
  },
];

export function modelPrice(model: string) {
  return MODEL_PRICES.find((item) => item.model === model) ?? null;
}

export function estimateModelCostUsdMicros(input: {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}) {
  const price = modelPrice(input.model);
  if (!price) return null;

  const uncachedInputTokens = Math.max(input.inputTokens - input.cachedInputTokens, 0);
  const numerator =
    uncachedInputTokens * price.inputUsdMicrosPerMillion +
    input.cachedInputTokens * price.cachedInputUsdMicrosPerMillion +
    input.outputTokens * price.outputUsdMicrosPerMillion;

  return {
    usdMicros: Math.ceil(numerator / 1_000_000),
    price,
  };
}
