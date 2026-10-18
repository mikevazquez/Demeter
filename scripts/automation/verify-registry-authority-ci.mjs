// GET-only observer of the preserved transport proof. Never reserves or runs a model.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { githubRequest } from "./execution-claim.mjs";
import { readRegistryAuthority } from "./registry-authority.mjs";
const PROOF = {
  ref: "refs/heads/governance2/coordination-proof-318-v1",
  genesisSha: "33df4aec4ae5174beb0dd2ca2fe01469ca5144a5",
};
const HEAD = "26d0827d4bbf77bb11c55894e3eb07927d933f3e";
const TASK = "g2-ea4ab6b9e56300aa4d3552041da2d3f254c1328d";
export function verifySharedRegistryProof({
  request = githubRequest,
  config = PROOF,
  expectedHead = HEAD,
  expectedTask = TASK,
} = {}) {
  let reads = 0;
  const readonly = (method, endpoint, body) => {
    if (method !== "GET" || body !== undefined) throw Error("CI observer forbids remote writes");
    reads++;
    return request(method, endpoint);
  };
  const { headSha, state } = readRegistryAuthority(config, { request: readonly });
  if (
    headSha !== expectedHead ||
    state.sequence !== 1 ||
    state.active !== expectedTask ||
    state.entries.length !== 1 ||
    state.history.length !== 0 ||
    state.entries[0].closure !== null
  )
    throw Error("Preserved coordination proof changed");
  return {
    schema: "governance2-independent-registry-observer-v1",
    ref: config.ref,
    genesisSha: config.genesisSha,
    headSha,
    active: state.active,
    entries: state.entries.length,
    remoteReads: reads,
    remoteWrites: 0,
    modelCalls: 0,
    generationAllowed: false,
  };
}
export function observeCanonicalRegistry(
  config,
  historySha256,
  historyCount,
  { request = githubRequest } = {},
) {
  let reads = 0;
  const readonly = (method, endpoint, body) => {
    if (method !== "GET" || body !== undefined)
      throw Error("Canonical observer forbids remote writes");
    reads++;
    return request(method, endpoint);
  };
  const { headSha, state } = readRegistryAuthority(config, { request: readonly });
  if (state.historySha256 !== historySha256 || state.history.length !== historyCount)
    throw Error("Pinned canonical import changed");
  return {
    ref: config.ref,
    genesisSha: config.genesisSha,
    headSha,
    historySha256,
    historyCount,
    active: state.active,
    entries: state.entries.length,
    remoteReads: reads,
    remoteWrites: 0,
    modelCalls: 0,
    generationAllowed: false,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expected = JSON.parse(
    fs.readFileSync(
      new URL("../../docs/automation/registry-authority-318.json", import.meta.url),
      "utf8",
    ),
  );
  const report = {
    canonical: observeCanonicalRegistry(
      expected.authority,
      expected.historySha256,
      expected.historyCount,
    ),
    ...verifySharedRegistryProof(),
    pid: process.pid,
    hostname: os.hostname(),
    originRegistryPresent: fs.existsSync("/workspace/work/evidence-318/registry"),
  };
  if (process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_TEMP) {
    const dir = path.join(process.env.RUNNER_TEMP, "governance2-recovery-evidence");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "registry-observer.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  console.log(JSON.stringify(report));
}
