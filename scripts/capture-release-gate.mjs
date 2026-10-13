import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { captureAttestation } from "./capture-schema-attestation.mjs";
import { validateReleaseManifest } from "./validate-release-manifest.mjs";

export function captureReleaseGate(manifest, config, run) {
  if (manifest?.target !== "production-staged")
    throw new Error("Expected production-staged manifest");
  if (manifest.candidate_sha !== config.candidateSha) throw new Error("Manifest SHA mismatch");
  const attestation = captureAttestation(config, run);
  const errors = validateReleaseManifest(manifest, {
    checkedOutSha: config.candidateSha,
    schemaAttestation: attestation,
    schemaAttestationKey: config.key,
  });
  if (errors.length) throw new Error("Release gate denied");
  return attestation;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 5)
      throw new Error("Expected manifest, candidate SHA and new output path");
    const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const evidence = captureReleaseGate(manifest, {
      candidateSha: process.argv[3],
      productionConnection: process.env.SF_GOV_PRODUCTION_READER_URL,
      candidateConnection: process.env.SF_GOV_CANDIDATE_READER_URL,
      key: process.env.SF_GOV_SCHEMA_ATTESTATION_KEY,
    });
    writeFileSync(process.argv[4], JSON.stringify(evidence, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log("PASS: captured schema and manifest; separate owner authorization still required");
  } catch {
    console.error("DENIED: protected release preflight failed");
    process.exitCode = 1;
  }
}
