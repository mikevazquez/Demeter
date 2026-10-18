// Trusted, narrow terminal transition: authentication failed before any model output.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { withRegistryMutation, isClosedBlockedAttempt } from "../studio-flow-minimal.mjs";
import { githubRequest } from "./execution-claim.mjs";
import { verifyRegistryTask, settleRegistryTask } from "./registry-authority.mjs";
import { readExecutionCheckpoint } from "./execution-checkpoint.mjs";
const API = "repos/mikevazquez/Demeter";
export const AUTH_REFRESH_ERROR =
  "Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.";
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (b) => createHash("sha256").update(b).digest("hex");
function raw(filename) {
  const stat = fs.lstatSync(filename);
  assert(
    stat.isFile() && stat.nlink === 1 && stat.size <= 1048576,
    "Unsafe terminal evidence file",
  );
  return fs.readFileSync(filename);
}
const read = (filename) => JSON.parse(raw(filename));
function inspect(repo, registry, id) {
  assert(/^[a-z0-9][a-z0-9-]{2,79}$/.test(id ?? ""), "Invalid terminal ID");
  const dir = path.join(registry, id),
    executor = path.join(dir, "executor");
  for (const p of [dir, executor])
    assert(
      fs.lstatSync(p).isDirectory() && !fs.lstatSync(p).isSymbolicLink(),
      "Unsafe terminal directory",
    );
  const state = read(path.join(dir, "reservation.json")),
    { task, contractSha256 } = state;
  assert(
    task.id === id &&
      hash(JSON.stringify(task)) === contractSha256 &&
      task.authorization === `https://github.com/mikevazquez/Demeter/issues/318`,
    "Terminal contract changed",
  );
  const resultBytes = raw(path.join(executor, "result.json")),
    result = JSON.parse(resultBytes);
  assert(
    result.id === id &&
      result.contractSha256 === contractSha256 &&
      result.status === "blocked" &&
      result.exitCode === 1 &&
      result.signal === null &&
      result.errorCode === null &&
      result.mode === "supervised-cli",
    "Only explicit blocked authentication exits may close",
  );
  const eventBytes = raw(path.join(executor, "events.jsonl"));
  assert(hash(eventBytes) === result.eventSha256, "Terminal events changed");
  const events = eventBytes.toString("utf8").trim().split("\n").map(JSON.parse);
  assert(
    events.length === 4 &&
      events[0].type === "thread.started" &&
      events[0].thread_id === result.sessionId &&
      events[1].type === "turn.started" &&
      events[2].type === "error" &&
      events[2].message === AUTH_REFRESH_ERROR &&
      events[3].type === "turn.failed" &&
      events[3].error?.message === AUTH_REFRESH_ERROR,
    "Authentication failure without any model items required",
  );
  for (const name of [
    "certificate.json",
    "publication.json",
    "published.json",
    "executor/model-result.json",
    "executor/artifact-intent.json",
  ])
    assert(
      !fs.existsSync(path.join(dir, name)),
      "Candidate or publication evidence forbids terminal closure",
    );
  for (const argv of [
    ["rev-parse", "HEAD"],
    ["status", "--porcelain", "--untracked-files=all"],
  ]) {
    const x = spawnSync("git", ["-C", repo, ...argv], { encoding: "utf8" });
    assert(
      x.status === 0 && x.stdout.trim() === (argv[0] === "rev-parse" ? task.baseSha : ""),
      "Clean original base required for terminal closure",
    );
  }
  return {
    dir,
    task,
    contractSha256,
    result,
    resultSha256: hash(resultBytes),
    checkpoint: read(path.join(executor, "checkpoint.json")),
    owner: read(path.join(executor, "remote-claim.json")),
    intent: read(path.join(executor, "intent.json")),
  };
}
export function closeAuthBlocked(repo, registry, id, { request = githubRequest, authority } = {}) {
  return withRegistryMutation(registry, () => {
    const s = inspect(repo, registry, id),
      identity = { ...s.task, contractSha256: s.contractSha256 };
    if (s.task.admission) verifyRegistryTask(s.task, authority, { request, allowClosed: true });
    const checked = readExecutionCheckpoint(id, identity, { request });
    assert(
      checked.objectSha === s.checkpoint.objectSha &&
        checked.checkpoint.owner.objectSha === s.owner.objectSha &&
        checked.checkpoint.owner.ownerNonce === s.owner.ownerNonce &&
        checked.checkpoint.intent?.startedAt === s.intent.startedAt,
      "Terminal owner, checkpoint or intent changed",
    );
    // Only 404 establishes absence; every other error retains the active reservation.
    for (const prefix of ["execution-results", "publication-claims"]) {
      try {
        request("GET", `${API}/git/ref/tags/vianelis/${prefix}/${id}`);
        throw new Error("Remote candidate or publication exists");
      } catch (error) {
        if (error.httpStatus !== 404) throw error;
      }
    }
    const prs = request(
      "GET",
      `${API}/pulls?state=all&head=${encodeURIComponent(`mikevazquez:studio-flow/minimal/${id}`)}&per_page=1`,
    );
    assert(Array.isArray(prs) && prs.length === 0, "Existing PR forbids terminal closure");
    const record = {
      schema: "governance2-auth-terminal-v1",
      id,
      baseSha: s.task.baseSha,
      contractSha256: s.contractSha256,
      status: "blocked",
      reason: "authentication-required",
      ownerObjectSha: s.owner.objectSha,
      checkpointObjectSha: checked.objectSha,
      resultSha256: s.resultSha256,
      eventSha256: s.result.eventSha256,
      sessionId: s.result.sessionId,
    };
    const name = `tags/vianelis/terminal-attempts/${id}`,
      ref = `refs/${name}`;
    let remote;
    try {
      remote = request("GET", `${API}/git/ref/${name}`);
    } catch (error) {
      if (error.httpStatus !== 404) throw error;
    }
    if (remote === undefined) {
      const lock = read(path.join(registry, "active.json"));
      assert(lock.id === id, "Original task lock required for new terminal transition");
      const tag = request("POST", `${API}/git/tags`, {
        tag: `governance2-terminal-${id}`,
        message: JSON.stringify(record),
        object: s.task.baseSha,
        type: "commit",
      });
      assert(/^[a-f0-9]{40}$/.test(tag?.sha ?? ""), "Invalid terminal tag");
      try {
        const created = request("POST", `${API}/git/refs`, { ref, sha: tag.sha });
        assert(
          created?.ref === ref && created.object?.sha === tag.sha,
          "Terminal creation unacknowledged",
        );
      } catch (error) {
        throw new Error("Terminal creation uncertain; inspect same attempt, never regenerate", {
          cause: error,
        });
      }
      remote = request("GET", `${API}/git/ref/${name}`);
      assert(remote?.object?.sha === tag.sha, "Terminal readback changed");
    }
    assert(
      remote?.ref === ref &&
        remote.object?.type === "tag" &&
        /^[a-f0-9]{40}$/.test(remote.object.sha),
      "Invalid terminal reference",
    );
    const tag = request("GET", `${API}/git/tags/${remote.object.sha}`);
    assert(
      tag?.sha === remote.object.sha &&
        tag.object?.type === "commit" &&
        tag.object.sha === s.task.baseSha &&
        tag.message === JSON.stringify(record),
      "Conflicting terminal evidence",
    );
    // Recheck original evidence after remote operations; no model result can be silently retired.
    assert(
      inspect(repo, registry, id).resultSha256 === s.resultSha256,
      "Terminal result changed during closure",
    );
    assert(
      readExecutionCheckpoint(id, identity, { request }).objectSha === checked.objectSha,
      "Terminal authority changed during closure",
    );
    const terminal = { ref, objectSha: tag.sha, record },
      filename = path.join(s.dir, "terminal.json");
    if (fs.existsSync(filename))
      assert(JSON.stringify(read(filename)) === JSON.stringify(terminal), "Local terminal differs");
    else fs.writeFileSync(filename, JSON.stringify(terminal) + "\n", { flag: "wx", mode: 0o600 });
    assert(isClosedBlockedAttempt(registry, id), "Terminal local readback failed");
    if (s.task.admission)
      settleRegistryTask(
        s.task,
        authority,
        { kind: "auth-blocked", objectSha: tag.sha, record },
        { request },
      );
    const lock = path.join(registry, "active.json");
    if (fs.existsSync(lock) && read(lock).id === id) fs.unlinkSync(lock);
    return {
      id,
      status: "closed-blocked",
      reason: record.reason,
      generationAllowed: false,
      terminalRef: ref,
      objectSha: tag.sha,
    };
  });
}
