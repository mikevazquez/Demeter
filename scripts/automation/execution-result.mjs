// Sealed candidate data only. Recovery never starts a model or executes contract commands.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { githubRequest, verifyExecutionOwner } from "./execution-claim.mjs";
import { readExecutionCheckpoint } from "./execution-checkpoint.mjs";
import { withRegistryMutation, isClosedBlockedAttempt } from "../studio-flow-minimal.mjs";
const API = "repos/mikevazquez/Demeter";
const SCHEMA = "governance2-execution-result-v1";
const MAX = 512 * 1024;
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (b) => createHash("sha256").update(b).digest("hex");
const json = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const bytes = (v) => Buffer.from(JSON.stringify(v) + "\n");
function git(repo, ...args) {
  const x = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 2 * MAX });
  assert(x.status === 0, "Recovery git inspection failed");
  return x.stdout;
}
function safePath(p) {
  return (
    typeof p === "string" &&
    /^[A-Za-z0-9_./-]+$/.test(p) &&
    !p.startsWith("/") &&
    !p.split("/").some((x) => ["", ".", "..", ".git"].includes(x))
  );
}
function noLinks(p) {
  for (let at = path.resolve(p); ; at = path.dirname(at)) {
    if (
      fs.existsSync(at) ||
      (() => {
        try {
          fs.lstatSync(at);
          return true;
        } catch {
          return false;
        }
      })()
    )
      assert(!fs.lstatSync(at).isSymbolicLink(), "Symlink recovery path rejected");
    if (at === path.dirname(at)) break;
  }
}
function changed(repo) {
  return [
    ...new Set(
      [
        ...git(repo, "diff", "--name-only", "--no-renames", "-z", "HEAD").split("\0"),
        ...git(repo, "ls-files", "--others", "--exclude-standard", "-z").split("\0"),
      ].filter(Boolean),
    ),
  ].sort();
}
function validateBundle(bundle, checkpoint) {
  const { task, contractSha256 } = checkpoint;
  assert(
    bundle?.schema === SCHEMA &&
      bundle.id === task.id &&
      bundle.baseSha === task.baseSha &&
      bundle.contractSha256 === contractSha256 &&
      JSON.stringify(bundle.reservation.task) === JSON.stringify(task) &&
      bundle.reservation.contractSha256 === contractSha256,
    "Result contract or identity mismatch",
  );
  assert(
    Object.keys(bundle).sort().join(",") ===
      "baseSha,contractSha256,files,id,intent,reservation,result,schema",
    "Unexpected result bundle field",
  );
  assert(
    Object.keys(bundle.reservation).sort().join(",") === "contractSha256,reservedAt,task" &&
      Number.isFinite(Date.parse(bundle.reservation.reservedAt)),
    "Invalid original reservation metadata",
  );
  const result = bundle.result;
  assert(
    Object.keys(result).every((k) =>
      [
        "id",
        "contractSha256",
        "status",
        "exitCode",
        "signal",
        "errorCode",
        "sessionId",
        "eventSha256",
        "finishedAt",
        "action",
        "mode",
      ].includes(k),
    ),
    "Unexpected model result field",
  );
  assert(
    result?.id === task.id &&
      result.contractSha256 === contractSha256 &&
      result.status === "candidate-ready" &&
      result.exitCode === 0 &&
      result.signal === null &&
      result.errorCode === null &&
      result.mode === "supervised-cli" &&
      typeof result.sessionId === "string" &&
      result.sessionId.length > 0 &&
      result.sessionId.length <= 120 &&
      /^[a-f0-9]{64}$/.test(result.eventSha256 ?? "") &&
      Number.isFinite(Date.parse(result.finishedAt)),
    "Only a completed successful model result may be sealed",
  );
  const intent = bundle.intent;
  assert(
    Object.keys(intent).every((k) =>
      ["id", "contractSha256", "baseSha", "continuity", "startedAt", "mode"].includes(k),
    ),
    "Unexpected execution intent field",
  );
  assert(
    checkpoint.intent !== null &&
      intent?.id === task.id &&
      intent.contractSha256 === contractSha256 &&
      intent.baseSha === task.baseSha &&
      intent.startedAt === checkpoint.intent.startedAt &&
      intent.mode === "supervised-cli" &&
      JSON.stringify(intent.continuity) === JSON.stringify(task.continuity),
    "Result intent mismatch",
  );
  assert(
    Array.isArray(bundle.files) &&
      bundle.files.length > 0 &&
      bundle.files.length <= task.allowedPaths.length &&
      new Set(bundle.files.map((f) => f.path)).size === bundle.files.length,
    "Invalid result file set",
  );
  for (const f of bundle.files) {
    assert(safePath(f.path) && task.allowedPaths.includes(f.path), "Out-of-scope result file");
    if (f.deleted === true) {
      assert(Object.keys(f).sort().join(",") === "deleted,path", "Invalid result deletion");
      continue;
    }
    assert(
      Object.keys(f).sort().join(",") === "contentBase64,mode,path,sha256" &&
        f.mode === "100644" &&
        typeof f.contentBase64 === "string" &&
        f.contentBase64.length <= 180000,
      "Unsafe result mode or oversized file",
    );
    const content = Buffer.from(f.contentBase64, "base64");
    assert(
      content.toString("base64") === f.contentBase64 &&
        content.length <= 128 * 1024 &&
        hash(content) === f.sha256,
      "Result file content hash mismatch",
    );
  }
  assert(bytes(bundle).length <= MAX, "Result bundle exceeds size limit");
}
function localMatches(repo, file) {
  const filename = path.join(repo, file.path);
  noLinks(filename);
  if (file.deleted) return !fs.existsSync(filename);
  if (!fs.existsSync(filename)) return false;
  const st = fs.lstatSync(filename);
  return (
    st.isFile() &&
    st.nlink === 1 &&
    !(st.mode & 0o111) &&
    hash(fs.readFileSync(filename)) === file.sha256
  );
}

export function captureExecutionResult(repo, state, intent, result) {
  assert(git(repo, "rev-parse", "HEAD").trim() === state.task.baseSha, "Candidate base changed");
  const files = changed(repo).map((p) => {
    assert(safePath(p) && state.task.allowedPaths.includes(p), "Out-of-scope candidate change");
    const filename = path.join(repo, p);
    noLinks(filename);
    if (!fs.existsSync(filename)) return { path: p, deleted: true };
    const st = fs.lstatSync(filename);
    assert(
      st.isFile() && st.nlink === 1 && !(st.mode & 0o111) && st.size <= 128 * 1024,
      "Unsafe candidate file",
    );
    const content = fs.readFileSync(filename);
    return {
      path: p,
      mode: "100644",
      sha256: hash(content),
      contentBase64: content.toString("base64"),
    };
  });
  return {
    schema: SCHEMA,
    id: state.task.id,
    baseSha: state.task.baseSha,
    contractSha256: state.contractSha256,
    reservation: {
      task: state.task,
      contractSha256: state.contractSha256,
      reservedAt: state.reservedAt,
    },
    intent,
    result,
    files,
  };
}

export function writeExecutionResult(bundle, { request = githubRequest } = {}) {
  const expected = { baseSha: bundle.baseSha, contractSha256: bundle.contractSha256 };
  const cp = readExecutionCheckpoint(bundle.id, expected, { request });
  validateBundle(bundle, cp.checkpoint);
  const payload = bytes(bundle),
    payloadSha256 = hash(payload);
  const refName = `tags/vianelis/execution-results/${bundle.id}`;
  let existing;
  try {
    existing = request("GET", `${API}/git/ref/${refName}`);
  } catch (e) {
    if (e.httpStatus !== 404) throw e;
  }
  if (existing !== undefined) {
    const observed = readExecutionResult(bundle.id, expected, { request });
    assert(
      observed.durableResult.objectSha === existing.object?.sha &&
        observed.durableResult.payloadSha256 === payloadSha256,
      "Existing sealed result differs",
    );
    return observed.durableResult;
  }
  const blob = request("POST", `${API}/git/blobs`, {
    encoding: "base64",
    content: payload.toString("base64"),
  });
  const gitSha = createHash("sha1")
    .update(Buffer.from(`blob ${payload.length}\0`))
    .update(payload)
    .digest("hex");
  assert(blob?.sha === gitSha, "Unacknowledged result blob");
  const message = {
    schema: SCHEMA,
    id: bundle.id,
    ...expected,
    checkpointObjectSha: cp.objectSha,
    ownerObjectSha: cp.checkpoint.owner.objectSha,
    payloadSha256,
  };
  const tag = request("POST", `${API}/git/tags`, {
    tag: `governance2-result-${bundle.id}`,
    message: JSON.stringify(message),
    object: blob.sha,
    type: "blob",
  });
  assert(/^[a-f0-9]{40}$/.test(tag?.sha ?? ""), "Invalid result tag");
  verifyExecutionOwner(
    { id: bundle.id, ...expected, authorization: bundle.reservation.task.authorization },
    cp.checkpoint.owner,
    { request },
  );
  try {
    const ref = request("POST", `${API}/git/refs`, { ref: `refs/${refName}`, sha: tag.sha });
    assert(
      ref?.ref === `refs/${refName}` && ref.object?.sha === tag.sha,
      "Result not acknowledged",
    );
  } catch (e) {
    throw new Error("Result sealing uncertain; reconcile existing result, never regenerate", {
      cause: e,
    });
  }
  const observed = readExecutionResult(bundle.id, expected, { request });
  assert(
    observed.durableResult.objectSha === tag.sha &&
      observed.durableResult.payloadSha256 === payloadSha256,
    "Sealed result readback changed",
  );
  return observed.durableResult;
}

export function readExecutionResult(id, expected, { request = githubRequest } = {}) {
  const cp = readExecutionCheckpoint(id, expected, { request });
  const refName = `tags/vianelis/execution-results/${id}`;
  const ref = request("GET", `${API}/git/ref/${refName}`);
  assert(
    ref?.ref === `refs/${refName}` &&
      ref.object?.type === "tag" &&
      /^[a-f0-9]{40}$/.test(ref.object?.sha ?? ""),
    "Invalid sealed result reference",
  );
  const tag = request("GET", `${API}/git/tags/${ref.object.sha}`);
  assert(
    tag?.sha === ref.object.sha &&
      tag.object?.type === "blob" &&
      /^[a-f0-9]{40}$/.test(tag.object.sha) &&
      typeof tag.message === "string" &&
      Buffer.byteLength(tag.message) < 4096,
    "Invalid sealed result tag",
  );
  const message = JSON.parse(tag.message);
  assert(
    message.schema === SCHEMA &&
      message.id === id &&
      message.baseSha === expected.baseSha &&
      message.contractSha256 === expected.contractSha256 &&
      message.checkpointObjectSha === cp.objectSha &&
      message.ownerObjectSha === cp.checkpoint.owner.objectSha &&
      /^[a-f0-9]{64}$/.test(message.payloadSha256 ?? ""),
    "Sealed result binding mismatch",
  );
  const blob = request("GET", `${API}/git/blobs/${tag.object.sha}`);
  assert(
    blob?.sha === tag.object.sha &&
      blob.encoding === "base64" &&
      blob.size <= MAX &&
      typeof blob.content === "string" &&
      blob.content.length <= MAX * 1.5,
    "Oversized result blob",
  );
  const payload = Buffer.from(blob.content, "base64");
  assert(
    payload.length === blob.size && hash(payload) === message.payloadSha256,
    "Sealed result hash mismatch",
  );
  const bundle = JSON.parse(payload.toString("utf8"));
  validateBundle(bundle, cp.checkpoint);
  return {
    bundle,
    checkpoint: cp,
    durableResult: {
      status: "recorded",
      ref: `refs/${refName}`,
      objectSha: tag.sha,
      payloadSha256: message.payloadSha256,
    },
  };
}

export function materializeCandidate(repo, recovered) {
  const { bundle } = recovered;
  assert(
    git(repo, "rev-parse", "HEAD").trim() === bundle.baseSha,
    "Recovery checkout must retain exact base",
  );
  const modified = changed(repo);
  for (const p of modified) {
    const f = bundle.files.find((f) => f.path === p);
    assert(f && localMatches(repo, f), "Existing user changes conflict with recovery");
  }
  for (const f of bundle.files) noLinks(path.join(repo, f.path));
  for (const f of bundle.files) {
    const filename = path.join(repo, f.path);
    if (localMatches(repo, f)) continue;
    if (f.deleted) {
      fs.unlinkSync(filename);
      continue;
    }
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    noLinks(filename);
    const temp = `${filename}.${randomUUID()}.recover`;
    const fd = fs.openSync(temp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, Buffer.from(f.contentBase64, "base64"));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(temp, 0o644);
    fs.renameSync(temp, filename);
  }
  assert(
    changed(repo).join("\0") ===
      bundle.files
        .map((f) => f.path)
        .sort()
        .join("\0") && bundle.files.every((f) => localMatches(repo, f)),
    "Recovered candidate bytes differ",
  );
  return { id: bundle.id, status: "candidate-restored", files: bundle.files.length };
}
function installJSON(filename, value) {
  noLinks(filename);
  if (fs.existsSync(filename)) {
    assert(
      JSON.stringify(json(filename)) === JSON.stringify(value),
      "Existing recovery metadata conflicts",
    );
    return;
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const fd = fs.openSync(filename, "wx", 0o600);
  try {
    fs.writeFileSync(fd, bytes(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function restoreExecution(
  repo,
  registry,
  id,
  expected,
  { request = githubRequest, verificationOnly = false } = {},
) {
  const relative = path.relative(path.resolve(repo), path.resolve(registry));
  assert(
    relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "Recovery registry must be outside candidate",
  );
  const recovered = readExecutionResult(id, expected, { request });
  const { bundle, checkpoint, durableResult } = recovered;
  // Existing PRs are reconciled, never turned into new work. Verification copies cannot publish.
  const filter = encodeURIComponent(`mikevazquez:studio-flow/minimal/${id}`);
  const prs = request("GET", `${API}/pulls?state=all&head=${filter}&per_page=100`);
  assert(Array.isArray(prs) && prs.length <= 1, "Ambiguous recovery PR history");
  if (prs.length && !verificationOnly)
    return { id, status: "reconcile-published-only", registryRestored: false };
  return withRegistryMutation(registry, () => {
    noLinks(registry);
    assert(
      verificationOnly || !fs.existsSync(path.join(registry, "verification-only.json")),
      "Verification copy cannot become operational",
    );
    const lock = path.join(registry, "active.json");
    noLinks(lock);
    if (fs.existsSync(lock)) assert(json(lock).id === id, "Another task owns recovery registry");
    if (fs.existsSync(registry)) {
      for (const entry of fs.readdirSync(registry, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === id || entry.name === ".mutation-lock") continue;
        if (isClosedBlockedAttempt(registry, entry.name)) continue;
        const prior = json(path.join(registry, entry.name, "reservation.json"));
        const published = json(path.join(registry, entry.name, "published.json"));
        assert(
          published.id === entry.name && prior.contractSha256 === published.contractSha256,
          "Unresolved registry history blocks recovery",
        );
      }
    }
    const dir = path.join(registry, id);
    noLinks(dir);
    for (const name of [
      "reservation.json",
      "publication.json",
      "certificate.json",
      "published.json",
      "executor/intent.json",
      "executor/remote-claim.json",
      "executor/result.json",
      "executor/model-result.json",
      "executor/artifact-intent.json",
      "executor/checkpoint.json",
    ])
      noLinks(path.join(dir, name));
    assert(
      !fs.existsSync(path.join(dir, "publication.json")),
      "Publication already started; reconcile only",
    );
    if (fs.existsSync(path.join(dir, "published.json")))
      return { id, status: "reconcile-published-only", registryRestored: false };
    if (fs.existsSync(path.join(dir, "reservation.json"))) {
      const prior = json(path.join(dir, "reservation.json"));
      assert(
        JSON.stringify(prior) === JSON.stringify(bundle.reservation),
        "Recovery reservation differs",
      );
    }
    const records = {
      "reservation.json": bundle.reservation,
      "executor/intent.json": bundle.intent,
      "executor/remote-claim.json": checkpoint.checkpoint.owner,
      "executor/checkpoint.json": {
        status: "recorded",
        ref: `refs/tags/vianelis/execution-checkpoints/${id}`,
        objectSha: checkpoint.objectSha,
      },
      "executor/model-result.json": bundle.result,
      "executor/artifact-intent.json": bundle,
      "executor/result.json": { ...bundle.result, durableResult },
      "recovery.json": { id, ...durableResult, generationAllowed: false },
    };
    for (const [name, value] of Object.entries(records)) {
      const filename = path.join(dir, name);
      noLinks(filename);
      if (fs.existsSync(filename))
        assert(
          JSON.stringify(json(filename)) === JSON.stringify(value),
          "Existing recovery metadata conflicts",
        );
    }
    // Candidate and local state are never overwritten if they conflict with sealed evidence.
    materializeCandidate(repo, recovered);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, value] of Object.entries(records)) installJSON(path.join(dir, name), value);
    if (verificationOnly)
      installJSON(path.join(registry, "verification-only.json"), { id, verificationOnly: true });
    installJSON(lock, { id });
    return {
      id,
      status: "candidate-ready",
      registryRestored: true,
      generationAllowed: false,
      verificationOnly,
      durableResult,
      files: bundle.files.length,
    };
  });
}

// Certification after recovery must cover exactly the immutable candidate, never a later rewrite.
export function verifyResultCertificate(certificate, recovered) {
  const { bundle } = recovered;
  assert(
    certificate?.passed === true &&
      certificate.baseSha === bundle.baseSha &&
      certificate.contractSha256 === bundle.contractSha256 &&
      Array.isArray(certificate.files),
    "Matching sealed-result certificate required",
  );
  const project = (files) =>
    files
      .map((f) =>
        f.deleted
          ? { path: f.path, deleted: true }
          : { path: f.path, mode: f.mode, sha256: f.sha256 },
      )
      .sort((a, b) => a.path.localeCompare(b.path));
  assert(
    JSON.stringify(project(certificate.files)) === JSON.stringify(project(bundle.files)),
    "Certificate differs from immutable result bytes",
  );
  return true;
}
