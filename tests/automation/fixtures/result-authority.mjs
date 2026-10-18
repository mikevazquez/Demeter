// Explicit in-memory GitHub and model-result fixtures. No network or model calls.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { reserve } from "../../../scripts/studio-flow-minimal.mjs";
import { writeExecutionCheckpoint } from "../../../scripts/automation/execution-checkpoint.mjs";
import {
  captureExecutionResult,
  writeExecutionResult,
} from "../../../scripts/automation/execution-result.mjs";
export function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "result-recovery-")),
    repo = path.join(root, "source"),
    registry = path.join(root, "source-registry");
  fs.mkdirSync(repo);
  const git = (at, ...args) => {
    const x = spawnSync("git", ["-C", at, ...args], { encoding: "utf8" });
    if (x.status !== 0) throw new Error(x.stderr);
    return x.stdout.trim();
  };
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.invalid");
  fs.writeFileSync(path.join(repo, "keep.txt"), "keep\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  const task = {
    id: "governance2-result-recovery-318-v1",
    goal: "Explicit fixture only",
    authorization: "https://github.com/mikevazquez/Demeter/issues/318",
    baseSha: git(repo, "rev-parse", "HEAD"),
    allowedPaths: ["proof.mjs", "keep.txt"],
    checks: [["node", "--check", "proof.mjs"]],
    continuity: { taskId: "continuity-315-38989415241" },
  };
  reserve(repo, registry, task, task.id);
  const dir = path.join(registry, task.id),
    state = JSON.parse(fs.readFileSync(path.join(dir, "reservation.json")));
  const identity = {
    id: task.id,
    baseSha: task.baseSha,
    contractSha256: state.contractSha256,
    authorization: task.authorization,
  };
  const owner = {
    status: "acquired",
    schema: "vianelis-execution-claim-v1",
    ...identity,
    ownerNonce: "fixture-owner",
    ref: `refs/tags/vianelis/execution-claims/${task.id}`,
    objectSha: "b".repeat(40),
  };
  const refs = new Map([
      [owner.ref, { ref: owner.ref, object: { sha: owner.objectSha, type: "tag" } }],
    ]),
    tags = new Map([
      [
        owner.objectSha,
        {
          sha: owner.objectSha,
          object: { sha: task.baseSha, type: "commit" },
          message: JSON.stringify({
            schema: owner.schema,
            ...identity,
            ownerNonce: owner.ownerNonce,
          }),
        },
      ],
    ]),
    blobs = new Map(),
    commits = new Map(),
    trees = new Map(),
    calls = [];
  let counter = 1,
    prs = [];
  const error = (status) =>
    Object.assign(new Error(`fixture HTTP ${status}`), { httpStatus: status });
  const request = (method, endpoint, body) => {
    calls.push({ method, endpoint, body });
    const prefix = "repos/mikevazquez/Demeter/git/";
    if (method === "GET" && endpoint.startsWith("repos/mikevazquez/Demeter/pulls?"))
      return structuredClone(prs);
    if (method === "GET" && /^repos\/mikevazquez\/Demeter\/pulls\/\d+$/.test(endpoint)) {
      const pr = prs.find(
        (p) =>
          p.html_url ===
          `https://github.com/mikevazquez/Demeter/pull/${endpoint.split("/").at(-1)}`,
      );
      if (!pr) throw error(404);
      return structuredClone(pr);
    }
    for (const [kind, objects] of [
      ["commits", commits],
      ["trees", trees],
    ]) {
      if (method === "GET" && endpoint.startsWith(prefix + kind + "/")) {
        const object = objects.get(endpoint.split("/").at(-1).split("?")[0]);
        if (!object) throw error(404);
        return structuredClone(object);
      }
      if (method === "POST" && endpoint === prefix + kind) {
        const sha = (++counter).toString(16).padStart(40, "0");
        objects.set(
          sha,
          kind === "trees"
            ? { sha, tree: body.tree, truncated: false }
            : { sha, tree: { sha: body.tree }, parents: body.parents.map((sha) => ({ sha })) },
        );
        return { sha };
      }
    }
    if (method === "PATCH" && endpoint.startsWith(prefix + "refs/")) {
      const ref = "refs/" + endpoint.slice((prefix + "refs/").length);
      if (
        body.force !== false ||
        commits.get(body.sha)?.parents[0].sha !== refs.get(ref)?.object.sha
      )
        throw error(422);
      const result = { ref, object: { sha: body.sha, type: "commit" } };
      refs.set(ref, result);
      return structuredClone(result);
    }
    if (method === "GET" && endpoint.startsWith(prefix + "ref/")) {
      const ref = refs.get("refs/" + endpoint.slice((prefix + "ref/").length));
      if (!ref) throw error(404);
      return structuredClone(ref);
    }
    if (method === "GET" && endpoint.startsWith(prefix + "tags/")) {
      const tag = tags.get(endpoint.slice((prefix + "tags/").length));
      if (!tag) throw error(404);
      return structuredClone(tag);
    }
    if (method === "GET" && endpoint.startsWith(prefix + "blobs/")) {
      const b = blobs.get(endpoint.slice((prefix + "blobs/").length));
      if (!b) throw error(404);
      return structuredClone(b);
    }
    if (method === "POST" && endpoint === prefix + "blobs") {
      const content = Buffer.from(body.content, "base64");
      const sha = createHash("sha1")
        .update(Buffer.from(`blob ${content.length}\0`))
        .update(content)
        .digest("hex");
      blobs.set(sha, { sha, encoding: "base64", size: content.length, content: body.content });
      return { sha };
    }
    if (method === "POST" && endpoint === prefix + "tags") {
      const sha = (++counter).toString(16).padStart(40, "0");
      tags.set(sha, { sha, object: { sha: body.object, type: body.type }, message: body.message });
      return { sha };
    }
    if (method === "POST" && endpoint === prefix + "refs") {
      if (refs.has(body.ref)) throw error(422);
      const ref = {
        ref: body.ref,
        object: { sha: body.sha, type: commits.has(body.sha) ? "commit" : "tag" },
      };
      refs.set(body.ref, ref);
      return structuredClone(ref);
    }
    throw new Error("Unexpected explicit fixture request");
  };
  const intent = {
    id: task.id,
    contractSha256: state.contractSha256,
    baseSha: task.baseSha,
    continuity: task.continuity,
    mode: "supervised-cli",
    startedAt: new Date().toISOString(),
  };
  const checkpoint = writeExecutionCheckpoint(state, owner, intent, { request });
  fs.writeFileSync(path.join(repo, "proof.mjs"), "export const proof = true;\n");
  const result = {
    id: task.id,
    contractSha256: state.contractSha256,
    status: "candidate-ready",
    exitCode: 0,
    signal: null,
    errorCode: null,
    sessionId: "explicit-fixture-session",
    eventSha256: createHash("sha256").update("fixture events").digest("hex"),
    finishedAt: new Date().toISOString(),
    action: "inspect-and-certify-existing-candidate",
    mode: "supervised-cli",
  };
  const bundle = () => captureExecutionResult(repo, state, intent, result);
  const fresh = () => {
    const target = path.join(root, "target-" + Math.random().toString(36).slice(2));
    git(root, "clone", "-q", repo, target);
    return { repo: target, registry: target + "-registry" };
  };
  return {
    root,
    repo,
    registry,
    state,
    owner,
    identity,
    task,
    intent,
    result,
    checkpoint,
    refs,
    tags,
    blobs,
    commits,
    trees,
    calls,
    request,
    error,
    bundle,
    fresh,
    git,
    setPrs: (p) => {
      prs = p;
    },
    seal: () => writeExecutionResult(bundle(), { request }),
  };
}
