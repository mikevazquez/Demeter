// Runs only in the existing GitHub runner. Downloads data with a read token, then certifies offline.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  readExecutionResult,
  restoreExecution,
  verifyResultCertificate,
} from "./execution-result.mjs";
import { verifyRegistryTask, verifyRegistryClosure } from "./registry-authority.mjs";
import { githubRequest } from "./execution-claim.mjs";
import { executeOnce, publishDraftOnce } from "./codex-executor.mjs";
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert(
  process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_RUN_ID,
  "Actual GitHub runner required",
);
assert.notEqual(os.hostname(), config.sourceHostname, "Fresh host required");
assert(
  !fs.existsSync("/workspace/work/evidence-318/registry"),
  "Origin registry must not be present",
);
const root = fs.mkdtempSync(
  path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "governance2-recovery-"),
);
const evidenceName = config.evidenceName ?? "governance2-recovery-evidence";
assert(/^governance2-[a-z0-9-]{3,100}$/.test(evidenceName), "Safe evidence name required");
const repo = path.join(root, "candidate"),
  registry = path.join(root, "registry"),
  out = path.join(process.env.RUNNER_TEMP, evidenceName);
fs.mkdirSync(out, { recursive: true });
function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  assert.equal(result.status, 0, `${binary} failed: ${(result.stderr ?? "").slice(-1200)}`);
  return result.stdout;
}
run("git", ["clone", "--quiet", "--no-hardlinks", "--no-checkout", process.cwd(), repo]);
run("git", ["-C", repo, "checkout", "--quiet", "--detach", config.baseSha]);
assert(
  !fs.existsSync(path.join(repo, ".git/objects/info/alternates")),
  "Recovery clone must be independent",
);
const headers = spawnSync(
  "git",
  ["-C", repo, "config", "--local", "--get-regexp", "^http\\..*extraheader$"],
  { encoding: "utf8" },
);
assert.equal(headers.status, 1, "No persisted authentication may enter the recovery clone");
let reads = 0;
const request = (method, endpoint, body) => {
  assert.equal(method, "GET", "Recovery forbids GitHub writes");
  reads++;
  return githubRequest(method, endpoint, body);
};
const recovered = readExecutionResult(config.id, config, { request });
assert.equal(recovered.durableResult.objectSha, config.resultObjectSha);
assert.equal(recovered.bundle.result.sessionId, config.sessionId);
let sharedAuthority = null;
if (config.authority) {
  const task = recovered.bundle.reservation.task;
  const observed = verifyRegistryTask(task, config.authority, { request, allowClosed: true });
  assert.deepEqual(
    observed.entry.closure,
    config.closedReceipt,
    "Exact closed shared receipt required",
  );
  verifyRegistryClosure({ ...task, contractSha256: config.contractSha256 }, config.closedReceipt, {
    request,
  });
  sharedAuthority = {
    ref: config.authority.ref,
    genesisSha: config.authority.genesisSha,
    headSha: observed.headSha,
    active: observed.state.active,
    closedId: task.id,
    closedReceipt: observed.entry.closure,
    historyCount: observed.state.history.length,
    entries: observed.state.entries.length,
  };
}
// CI recertifies bytes even after a PR exists; it must never restore operational authority.
const restored = restoreExecution(repo, registry, config.id, config, {
  request,
  verificationOnly: true,
});
assert(restored.registryRestored && !restored.generationAllowed && restored.verificationOnly);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(registry, "verification-only.json"))), {
  id: config.id,
  verificationOnly: true,
});
assert.throws(
  () => publishDraftOnce(repo, registry, config.id, {}, { request }),
  /Verification registry/,
);
const replay = executeOnce(repo, registry, config.id, {
  binary: "/must-not-spawn",
  claim: () => {
    throw new Error("Recovery must not reserve");
  },
});
assert.equal(replay.sessionId, config.sessionId);
assert.equal(replay.status, "candidate-ready");
for (const name of ["package.json", "package-lock.json"])
  assert.equal(
    createHash("sha256")
      .update(fs.readFileSync(path.join(repo, name)))
      .digest("hex"),
    createHash("sha256").update(fs.readFileSync(name)).digest("hex"),
    "Dependencies must match recovered base",
  );
// The public runtime image is resolved to an immutable local image ID before execution.
run("docker", ["pull", "node:22-bookworm"]);
const image = run("docker", ["image", "inspect", "node:22-bookworm", "--format", "{{.Id}}"]).trim();
assert(/^sha256:[a-f0-9]{64}$/.test(image));
const mounts = [
  [repo, "/candidate"],
  [registry, "/registry"],
  [path.resolve("node_modules"), "/candidate/node_modules", "ro"],
  [path.join(repo, "scripts/studio-flow-minimal.mjs"), "/tools/certify.mjs", "ro"],
];
const args = [
  "create",
  "--network",
  "none",
  "--read-only",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--pids-limit",
  "256",
  "--memory",
  "3g",
  "--cpus",
  "2",
  "--user",
  `${process.getuid()}:${process.getgid()}`,
  "--tmpfs",
  "/tmp:rw,nosuid,nodev,mode=1777",
  "--env",
  "HOME=/tmp",
  "--env",
  "TMPDIR=/tmp",
  "--workdir",
  "/candidate",
];
for (const [src, dst, ro] of mounts) {
  assert(!src.includes(","));
  args.push("--mount", `type=bind,src=${src},dst=${dst}${ro ? ",readonly" : ""}`);
}
args.push(image, "node", "/tools/certify.mjs", "certify", "/candidate", "/registry", config.id);
const container = run("docker", args).trim();
assert(/^[a-f0-9]{64}$/.test(container));
let inspect;
try {
  inspect = JSON.parse(run("docker", ["inspect", container]))[0];
  assert.equal(inspect.HostConfig.NetworkMode, "none");
  assert(inspect.HostConfig.ReadonlyRootfs && !inspect.HostConfig.Privileged);
  assert(inspect.HostConfig.CapDrop.includes("ALL"));
  assert(
    inspect.Config.Env.every((v) =>
      ["PATH", "NODE_VERSION", "YARN_VERSION", "HOME", "TMPDIR"].includes(v.split("=")[0]),
    ),
    "Unexpected container environment binding",
  );
  const execution = spawnSync("docker", ["start", "--attach", container], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(out, "certification.log"), execution.stdout + execution.stderr);
  const finished = JSON.parse(run("docker", ["inspect", container]))[0];
  assert.equal(finished.State.ExitCode, 0, "Offline certification failed");
  assert.equal(execution.status, 0);
} finally {
  run("docker", ["rm", "--force", container]);
}
const certificate = JSON.parse(fs.readFileSync(path.join(registry, config.id, "certificate.json")));
verifyResultCertificate(certificate, recovered);
assert.equal(certificate.contractSha256, config.contractSha256);
for (const file of certificate.files) {
  const sealed = recovered.bundle.files.find((f) => f.path === file.path);
  assert(sealed && sealed.sha256 === file.sha256 && sealed.mode === file.mode);
}
fs.writeFileSync(path.join(out, "certificate.json"), JSON.stringify(certificate) + "\n");
const report = {
  schema: "governance2-fresh-host-candidate-recovery-v1",
  runner: os.hostname(),
  runId: process.env.GITHUB_RUN_ID,
  id: config.id,
  baseSha: config.baseSha,
  contractSha256: config.contractSha256,
  resultObjectSha: config.resultObjectSha,
  sessionId: config.sessionId,
  sharedAuthority,
  remoteReads: reads,
  remoteWrites: 0,
  modelCalls: 0,
  originRegistryPresent: false,
  registryRestored: true,
  verificationOnly: true,
  publicationBlocked: true,
  replayCandidateReady: true,
  offlineCertificatePassed: true,
  files: certificate.files,
  image,
  container: { network: "none", readOnly: true, privileged: false, capDrop: ["ALL"] },
};
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
