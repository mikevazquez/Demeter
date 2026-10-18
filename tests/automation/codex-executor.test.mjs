import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  reserveContinued,
  verifyContinuity,
  executeOnce as guardedExecuteOnce,
  executionStatus,
  sealExistingResult,
  executorEnvironment,
  collectContinuity,
} from "../../scripts/automation/codex-executor.mjs";
import { certify, publicationPlan, complete } from "../../scripts/studio-flow-minimal.mjs";
import { serializeState } from "../../scripts/automation/continuity-lab.mjs";

// Trusted in-process claim double: these tests deliberately make no network/model calls.
const executeOnce = (repo, registry, id, options = {}) =>
  guardedExecuteOnce(repo, registry, id, {
    claim: () => ({ status: "acquired" }),
    checkpoint: () => ({ status: "recorded" }),
    seal: () => ({ status: "recorded", objectSha: "a".repeat(40), payloadSha256: "b".repeat(64) }),
    ...options,
  });
const FIRST = 38989415241;
const SECOND = 38999999999;
const ID = `continuity-315-${FIRST}`;
const OWNED_CODE_ID = "governance2-owned-code-318-v1";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function evidence() {
  return {
    comments: [
      {
        id: 1,
        user: { login: "github-actions[bot]", type: "Bot" },
        body: serializeState({ phase: "waiting", startedBy: FIRST, completedBy: null }),
      },
      {
        id: 2,
        user: { login: "github-actions[bot]", type: "Bot" },
        body: serializeState({ phase: "complete", startedBy: FIRST, completedBy: SECOND }),
      },
    ],
    runs: [FIRST, SECOND].map((id, index) => ({
      id,
      event: index ? "schedule" : "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      repository: { full_name: "mikevazquez/Demeter" },
      path: ".github/workflows/continuity-lab-315.yml",
      head_sha: "a".repeat(40),
    })),
  };
}
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "executor-318-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const registry = path.join(root, "registry");
  fs.mkdirSync(repo);
  const git = (...args) => {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("commit", "--allow-empty", "-qm", "base");
  const task = {
    id: ID,
    goal: "Create a harmless ESM proof",
    authorization: "https://github.com/mikevazquez/Demeter/issues/318",
    baseSha: git("rev-parse", "HEAD"),
    allowedPaths: ["proof.mjs"],
    checks: [["node", "--check", "proof.mjs"]],
  };
  reserveContinued(repo, registry, task, evidence());
  return { root, repo, registry, task };
}
function ownedCodeEvidence() {
  const e = evidence();
  e.comments[0].id = 6227744429;
  e.comments[1].id = 6233729702;
  e.comments[1].body = serializeState({
    phase: "complete",
    startedBy: FIRST,
    completedBy: 39031527323,
  });
  e.runs[1].id = 39031527323;
  for (const run of e.runs) run.head_sha = "19fabb01d5d40c0b6aa75a3e9eb4be1eb60cde54";
  return e;
}
function fakeCli(root, source) {
  const filename = path.join(root, "fake-codex");
  fs.writeFileSync(filename, `#!${process.execPath}\n${source}\n`, { mode: 0o700 });
  return filename;
}
const success = `const fs = require('node:fs'); fs.readFileSync(0); fs.writeFileSync('proof.mjs', 'export const proof = true;\\n'); console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-session'})); console.log(JSON.stringify({type:'turn.completed'}));`;

describe("Codex executor 318 (explicit CLI doubles, no model calls)", () => {
  it("reads all comment pages and refuses failed remote lookups", () => {
    const e = evidence();
    const paths = [];
    const response = collectContinuity((endpoint) => {
      paths.push(endpoint);
      if (endpoint.endsWith("&page=1"))
        return [
          ...Array.from({ length: 99 }, (_, i) => ({
            id: i + 10,
            user: { type: "User" },
            body: "ordinary",
          })),
          e.comments[0],
        ];
      if (endpoint.endsWith("&page=2")) return [e.comments[1]];
      return e.runs.find((r) => endpoint.endsWith(String(r.id)));
    });
    expect(response.comments.length).toBe(101);
    expect(verifyContinuity(response.comments, response.runs).completedBy).toBe(SECOND);
    expect(paths.some((p) => p.includes("page=2"))).toBe(true);
    expect(() =>
      collectContinuity(() => {
        throw new Error("401 fixture");
      }),
    ).toThrow("401");
  });
  it("does not launch over an existing dirty candidate", () => {
    const s = setup();
    fs.writeFileSync(path.join(s.repo, "proof.mjs"), "export const proof=true;");
    expect(() => executeOnce(s.repo, s.registry, ID, { binary: "/must/not/run" })).toThrow("clean");
  });
  it("never starts the model after a remote conflict or an unavailable authority", () => {
    for (const claim of [
      () => ({ status: "consumed" }),
      () => {
        throw new Error("authority unavailable");
      },
    ]) {
      const s = setup();
      const binary = fakeCli(s.root, success);
      expect(() =>
        executeOnce(s.repo, s.registry, ID, {
          binary,
          claim,
          checkpoint: () => ({ status: "recorded" }),
          seal: () => ({
            status: "recorded",
            objectSha: "a".repeat(40),
            payloadSha256: "b".repeat(64),
          }),
        }),
      ).toThrow();
      expect(fs.existsSync(path.join(s.repo, "proof.mjs"))).toBe(false);
      expect(executionStatus(s.repo, s.registry, ID).status).toBe("uncertain");
      expect(
        executeOnce(s.repo, s.registry, ID, {
          binary,
          claim: () => {
            throw new Error("must not claim twice");
          },
        }).status,
      ).toBe("uncertain");
    }
  });
  it("cannot spawn if durable checkpoint fails and cannot retry generation afterward", () => {
    const s = setup();
    const binary = fakeCli(s.root, success);
    let checkpoints = 0;
    const checkpoint = () => {
      checkpoints++;
      throw new Error("checkpoint response lost");
    };
    expect(() => executeOnce(s.repo, s.registry, ID, { binary, checkpoint })).toThrow(
      "response lost",
    );
    expect(fs.existsSync(path.join(s.repo, "proof.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(s.registry, ID, "executor", "events.jsonl"))).toBe(false);
    expect(executionStatus(s.repo, s.registry, ID).status).toBe("uncertain");
    expect(executeOnce(s.repo, s.registry, ID, { binary, checkpoint }).status).toBe("uncertain");
    expect(checkpoints).toBe(1);
  });
  it("confirms a checkpoint bound to the actual intent before spawning the explicit CLI double", () => {
    const s = setup();
    const binary = fakeCli(s.root, success);
    let observed;
    const checkpoint = (state, owner, intent) => {
      expect(fs.existsSync(path.join(s.repo, "proof.mjs"))).toBe(false);
      expect(fs.existsSync(path.join(s.registry, ID, "executor", "events.jsonl"))).toBe(false);
      expect(intent.contractSha256).toBe(state.contractSha256);
      expect(intent.id).toBe(ID);
      expect(owner.status).toBe("acquired");
      observed = intent;
      return { status: "recorded", objectSha: "a".repeat(40) };
    };
    expect(executeOnce(s.repo, s.registry, ID, { binary, checkpoint }).status).toBe(
      "candidate-ready",
    );
    expect(observed.mode).toBe("supervised-cli");
    expect(
      JSON.parse(fs.readFileSync(path.join(s.registry, ID, "executor", "checkpoint.json"))).status,
    ).toBe("recorded");
  });
  it("retries sealing the frozen result without another generation", () => {
    const s = setup(),
      binary = fakeCli(s.root, success);
    let seals = 0;
    const seal = () => {
      seals++;
      throw new Error("result response lost");
    };
    expect(() => executeOnce(s.repo, s.registry, ID, { binary, seal })).toThrow("response lost");
    expect(executionStatus(s.repo, s.registry, ID)).toMatchObject({
      status: "uncertain",
      errorCode: "DURABILITY_PENDING",
    });
    fs.unlinkSync(binary);
    expect(executeOnce(s.repo, s.registry, ID, { binary, seal }).status).toBe("uncertain");
    expect(seals).toBe(1);
    expect(
      sealExistingResult(s.repo, s.registry, ID, { seal: () => ({ status: "recorded" }) }).status,
    ).toBe("candidate-ready");
  });
  it("prepares only once before freezing and never reruns preparation on a seal retry", () => {
    const s = setup(),
      binary = fakeCli(s.root, success);
    let prepared = 0;
    const prepareCandidate = (repo) => {
      prepared++;
      fs.writeFileSync(
        path.join(repo, "proof.mjs"),
        "// supervisor format\nexport const proof = true;\n",
      );
    };
    expect(() =>
      executeOnce(s.repo, s.registry, ID, {
        binary,
        prepareCandidate,
        seal: () => {
          throw new Error("lost");
        },
      }),
    ).toThrow("lost");
    fs.unlinkSync(binary);
    const recovered = sealExistingResult(s.repo, s.registry, ID, {
      prepareCandidate,
      seal: (bundle) => {
        expect(Buffer.from(bundle.files[0].contentBase64, "base64").toString()).toContain(
          "supervisor format",
        );
        return { status: "recorded" };
      },
    });
    expect(recovered.status).toBe("candidate-ready");
    expect(prepared).toBe(1);
  });
  it("rejects out-of-scope output before invoking the supervisor preparation tool", () => {
    const s = setup(),
      binary = fakeCli(s.root, success + "fs.writeFileSync('outside.txt','unexpected');");
    let prepared = 0;
    expect(() =>
      executeOnce(s.repo, s.registry, ID, {
        binary,
        prepareCandidate: () => {
          prepared++;
        },
      }),
    ).toThrow("Out-of-scope");
    expect(prepared).toBe(0);
    expect(executionStatus(s.repo, s.registry, ID).status).toBe("uncertain");
  });
  it("does not seal changed bytes after a durability failure", () => {
    const s = setup(),
      binary = fakeCli(s.root, success);
    expect(() =>
      executeOnce(s.repo, s.registry, ID, {
        binary,
        seal: () => {
          throw new Error("lost");
        },
      }),
    ).toThrow("lost");
    fs.writeFileSync(path.join(s.repo, "proof.mjs"), "export const changed=true;\n");
    expect(() =>
      sealExistingResult(s.repo, s.registry, ID, { seal: () => ({ status: "recorded" }) }),
    ).toThrow("changed after result intent");
  });
  it("records timeout without allowing regeneration", () => {
    const s = setup();
    const binary = fakeCli(s.root, "setInterval(()=>{},1000);");
    const result = executeOnce(s.repo, s.registry, ID, { binary, timeout: 100 });
    expect(result.status).toBe("blocked");
    expect(result.errorCode).toBe("ETIMEDOUT");
    expect(executeOnce(s.repo, s.registry, ID, { binary: "/must/not/run" })).toEqual(result);
  });

  it("requires the actual origin and a different successful scheduled run", () => {
    const e = evidence();
    expect(verifyContinuity(e.comments, e.runs).completedBy).toBe(SECOND);
    e.runs[1].event = "workflow_dispatch";
    expect(() => verifyContinuity(e.comments, e.runs)).toThrow("schedule");
    e.runs[1].event = "schedule";
    e.runs[1].conclusion = "failure";
    expect(() => verifyContinuity(e.comments, e.runs)).toThrow("Unsuccessful");
  });
  it("rejects pending, duplicate, forged and unrelated evidence", () => {
    const e = evidence();
    expect(() => verifyContinuity(e.comments.slice(0, 1), e.runs)).toThrow("two");
    expect(() => verifyContinuity([...e.comments, { ...e.comments[1], id: 3 }], e.runs)).toThrow(
      "two",
    );
    e.comments[1].user.type = "User";
    expect(() => verifyContinuity(e.comments, e.runs)).toThrow("two");
    const other = evidence();
    other.runs[1].repository.full_name = "other/repo";
    expect(() => verifyContinuity(other.comments, other.runs)).toThrow("unrelated");
  });
  it("never turns a missing or duplicated run response into proof", () => {
    const e = evidence();
    expect(() => verifyContinuity(e.comments, [e.runs[0]])).toThrow("Unique");
    expect(() => verifyContinuity(e.comments, [...e.runs, e.runs[1]])).toThrow("Unique");
  });
  it("rejects a different task ID and consumes only the existing reservation", () => {
    const s = setup();
    expect(() =>
      reserveContinued(s.repo, s.registry, { ...s.task, id: "different-task" }, evidence()),
    ).toThrow("bind");
    expect(() => reserveContinued(s.repo, s.registry, s.task, evidence())).toThrow("consumed");
  });
  it("binds the separately authorized launcher task to the original continuity without recycling its ID", () => {
    const s = setup();
    const registry = path.join(s.root, "launcher-registry");
    const task = { ...s.task, id: "vianelis-launcher-318-v1" };
    expect(() =>
      reserveContinued(
        s.repo,
        registry,
        { ...task, authorization: "https://example.invalid" },
        evidence(),
      ),
    ).toThrow("bind");
    expect(() => reserveContinued(s.repo, registry, task, { ...evidence(), comments: [] })).toThrow(
      "two",
    );
    reserveContinued(s.repo, registry, task, evidence());
    const stored = JSON.parse(fs.readFileSync(path.join(registry, task.id, "reservation.json")));
    expect(stored.task.continuity.taskId).toBe(ID);
    expect(stored.task.id).not.toBe(ID);
    expect(() => reserveContinued(s.repo, registry, task, evidence())).toThrow("consumed");
    const binary = fakeCli(s.root, success);
    const result = executeOnce(s.repo, registry, task.id, { binary });
    expect(result.status).toBe("candidate-ready");
    expect(executionStatus(s.repo, registry, task.id)).toEqual(result);
    expect(executeOnce(s.repo, registry, task.id, { binary: "/must/not/run" })).toEqual(result);
    const reservationPath = path.join(registry, task.id, "reservation.json");
    stored.task.continuity.taskId = task.id;
    stored.contractSha256 = createHash("sha256").update(JSON.stringify(stored.task)).digest("hex");
    fs.writeFileSync(reservationPath, JSON.stringify(stored));
    expect(() => executionStatus(s.repo, registry, task.id)).toThrow("continuity");
  });
  it("preserves original provenance for the owned code ID and reuses its single execution", () => {
    const s = setup();
    const registry = path.join(s.root, "owned-code-registry");
    const task = { ...s.task, id: OWNED_CODE_ID };
    reserveContinued(s.repo, registry, task, ownedCodeEvidence());
    const dir = path.join(registry, task.id);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, "reservation.json")));
    const continuity = {
      taskId: ID,
      startedBy: FIRST,
      completedBy: 39031527323,
      startSha: "19fabb01d5d40c0b6aa75a3e9eb4be1eb60cde54",
      recoverySha: "19fabb01d5d40c0b6aa75a3e9eb4be1eb60cde54",
      commentIds: [6227744429, 6233729702],
    };
    expect(stored.task.id).toBe(OWNED_CODE_ID);
    expect(stored.task.continuity).toEqual(continuity);
    expect(() => reserveContinued(s.repo, registry, task, ownedCodeEvidence())).toThrow("consumed");
    const binary = fakeCli(s.root, success);
    const claims = [];
    const claim = (request) => {
      claims.push(request);
      return { status: "acquired" };
    };
    const result = guardedExecuteOnce(s.repo, registry, task.id, {
      binary,
      claim,
      checkpoint: () => ({ status: "recorded" }),
      seal: () => ({
        status: "recorded",
        objectSha: "a".repeat(40),
        payloadSha256: "b".repeat(64),
      }),
    });
    expect(result.status).toBe("candidate-ready");
    expect(claims).toEqual([
      {
        id: task.id,
        baseSha: task.baseSha,
        contractSha256: stored.contractSha256,
        authorization: task.authorization,
      },
    ]);
    const intent = JSON.parse(fs.readFileSync(path.join(dir, "executor", "intent.json")));
    expect(intent.continuity).toEqual(continuity);
    expect(executionStatus(s.repo, registry, task.id)).toEqual(result);
    fs.unlinkSync(binary);
    expect(
      guardedExecuteOnce(s.repo, registry, task.id, {
        binary,
        claim,
        checkpoint: () => ({ status: "recorded" }),
        seal: () => ({
          status: "recorded",
          objectSha: "a".repeat(40),
          payloadSha256: "b".repeat(64),
        }),
      }),
    ).toEqual(result);
    expect(claims).toHaveLength(1);
  });
  it("rejects unauthorized owned code reservations, invalid continuity and arbitrary IDs", () => {
    const s = setup();
    const registry = path.join(s.root, "owned-code-registry");
    const task = { ...s.task, id: OWNED_CODE_ID };
    expect(() =>
      reserveContinued(
        s.repo,
        registry,
        { ...task, authorization: "https://example.invalid" },
        ownedCodeEvidence(),
      ),
    ).toThrow("bind");
    expect(() =>
      reserveContinued(s.repo, registry, task, { ...ownedCodeEvidence(), comments: [] }),
    ).toThrow("two");
    const manual = ownedCodeEvidence();
    manual.runs[1].event = "workflow_dispatch";
    expect(() => reserveContinued(s.repo, registry, task, manual)).toThrow("schedule");
    expect(() =>
      reserveContinued(
        s.repo,
        registry,
        { ...task, id: `${OWNED_CODE_ID}-other` },
        ownedCodeEvidence(),
      ),
    ).toThrow("bind");
    expect(fs.existsSync(registry)).toBe(false);
  });
  it("rejects changed owned code authorization, continuity and arbitrary IDs in execution context", () => {
    const s = setup();
    const registry = path.join(s.root, "owned-code-registry");
    const task = { ...s.task, id: OWNED_CODE_ID };
    reserveContinued(s.repo, registry, task, ownedCodeEvidence());
    const dir = path.join(registry, task.id);
    const original = JSON.parse(fs.readFileSync(path.join(dir, "reservation.json")));
    for (const change of [
      { authorization: "https://example.invalid" },
      { continuity: { ...original.task.continuity, taskId: OWNED_CODE_ID } },
      { id: `${OWNED_CODE_ID}-other` },
    ]) {
      const stored = { ...original, task: { ...original.task, ...change } };
      stored.contractSha256 = createHash("sha256")
        .update(JSON.stringify(stored.task))
        .digest("hex");
      const changedDir = path.join(registry, stored.task.id);
      fs.mkdirSync(changedDir, { recursive: true });
      fs.writeFileSync(path.join(changedDir, "reservation.json"), JSON.stringify(stored));
      expect(() => executionStatus(s.repo, registry, stored.task.id)).toThrow("continuity");
    }
  });
  it("excludes publication and application credentials from the child environment", () => {
    expect(
      executorEnvironment({
        PATH: "/bin",
        HTTPS_PROXY: "proxy",
        GH_TOKEN: "secret",
        GITHUB_TOKEN: "secret",
        OPENAI_API_KEY: "secret",
        NEXT_PUBLIC_SUPABASE_URL: "private",
      }),
    ).toEqual({ PATH: "/bin", HTTPS_PROXY: "proxy" });
  });
  it("executes a subprocess once, then certifies and reuses a single Draft", () => {
    const s = setup();
    const binary = fakeCli(s.root, success);
    const result = executeOnce(s.repo, s.registry, ID, { binary });
    expect(result.status).toBe("candidate-ready");
    expect(result.sessionId).toBe("fixture-session");
    fs.unlinkSync(binary);
    expect(executeOnce(s.repo, s.registry, ID, { binary })).toEqual(result);
    expect(certify(s.repo, s.registry, ID).passed).toBe(true);
    const branch = `studio-flow/minimal/${ID}`;
    const remote = { branch, baseSha: s.task.baseSha, headSha: null, pullRequests: [] };
    expect(publicationPlan(s.repo, s.registry, ID, remote).action).toBe("create-draft");
    // Simulated remote receipt: unit integration, not proof of GitHub publication.
    const receipt = {
      branch,
      commitSha: "b".repeat(40),
      draft: true,
      url: "https://github.com/mikevazquez/Demeter/pull/999999",
    };
    remote.headSha = receipt.commitSha;
    remote.pullRequests = [{ ...receipt, state: "OPEN" }];
    expect(publicationPlan(s.repo, s.registry, ID, remote).action).toBe("reuse-draft");
    expect(complete(s.repo, s.registry, ID, receipt).status).toBe("published-draft");
    expect(complete(s.repo, s.registry, ID, receipt).url).toBe(receipt.url);
    expect(() => executeOnce(s.repo, s.registry, ID, { binary })).toThrow();
  });
  it("two supervisor processes cannot launch the same task twice", async () => {
    const s = setup();
    const count = path.join(s.root, "launches");
    const binary = fakeCli(
      s.root,
      `require('node:fs').appendFileSync(${JSON.stringify(count)}, 'launch\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150); ${success}`,
    );
    const modulePath = path.resolve("scripts/automation/codex-executor.mjs");
    const source = `import {executeOnce} from ${JSON.stringify(modulePath)}; executeOnce(${JSON.stringify(s.repo)},${JSON.stringify(s.registry)},${JSON.stringify(ID)},{binary:${JSON.stringify(binary)},claim:()=>({status:"acquired"}),checkpoint:()=>({status:"recorded"}),seal:()=>({status:"recorded"})});`;
    const launch = () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
          stdio: "ignore",
        });
        child.once("error", reject);
        child.once("exit", resolve);
      });
    expect(await Promise.all([launch(), launch()])).toEqual([0, 0]);
    expect(fs.readFileSync(count, "utf8")).toBe("launch\n");
    expect(executionStatus(s.repo, s.registry, ID).status).toBe("candidate-ready");
  });
  it("persists CLI auth failure without retry, certification or publication", () => {
    const s = setup();
    const binary = fakeCli(
      s.root,
      `console.log(JSON.stringify({type:'turn.failed',error:{message:'401 fixture'}})); process.exitCode=1;`,
    );
    const result = executeOnce(s.repo, s.registry, ID, { binary });
    expect(result.status).toBe("blocked");
    fs.unlinkSync(binary);
    expect(executeOnce(s.repo, s.registry, ID, { binary })).toEqual(result);
    expect(() => publicationPlan(s.repo, s.registry, ID, {})).toThrow();
  });
  it("requires a completion event even when the executable exits zero", () => {
    const s = setup();
    const binary = fakeCli(s.root, "console.log('{}');");
    expect(executeOnce(s.repo, s.registry, ID, { binary }).status).toBe("blocked");
  });
  it("fails closed after a crash before intent persistence", () => {
    const s = setup();
    expect(() => executionStatus(s.repo, s.registry, ID)).toThrow();
    fs.mkdirSync(path.join(s.registry, ID, "executor"));
    const uncertain = { id: ID, status: "uncertain", action: "inspect-existing-candidate" };
    expect(executionStatus(s.repo, s.registry, ID)).toEqual(uncertain);
    expect(executeOnce(s.repo, s.registry, ID, { binary: "/must/not/run" })).toEqual(uncertain);
    const status = spawnSync(
      process.execPath,
      ["scripts/automation/codex-executor.mjs", "status", s.repo, s.registry, ID],
      { encoding: "utf8" },
    );
    expect(status.status).toBe(0);
    expect(status.stderr).toBe("");
    expect(JSON.parse(status.stdout)).toEqual(uncertain);
  });
  it("rejects reservation tampering before launching", () => {
    const s = setup();
    const filename = path.join(s.registry, ID, "reservation.json");
    const state = JSON.parse(fs.readFileSync(filename));
    state.task.goal = "tampered";
    fs.writeFileSync(filename, JSON.stringify(state));
    expect(() => executeOnce(s.repo, s.registry, ID)).toThrow("changed");
  });
  it("preserves candidate across SIGKILL and a new supervisor process without regeneration", async () => {
    const s = setup();
    const childPidFile = path.join(s.root, "child.pid");
    const binary = fakeCli(
      s.root,
      `${success} require('node:fs').writeFileSync(${JSON.stringify(childPidFile)}, String(process.pid)); setInterval(()=>{},1000);`,
    );
    const modulePath = path.resolve("scripts/automation/codex-executor.mjs");
    const parent = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {executeOnce} from ${JSON.stringify(modulePath)}; executeOnce(${JSON.stringify(s.repo)},${JSON.stringify(s.registry)},${JSON.stringify(ID)},{binary:${JSON.stringify(binary)},claim:()=>({status:"acquired"}),checkpoint:()=>({status:"recorded"}),seal:()=>({status:"recorded"})});`,
      ],
      { stdio: "ignore" },
    );
    const exited = new Promise((resolve) => parent.once("exit", resolve));
    let childPid;
    try {
      for (let i = 0; i < 100 && !fs.existsSync(childPidFile); i++)
        await new Promise((r) => setTimeout(r, 20));
      expect(fs.existsSync(childPidFile)).toBe(true);
      childPid = Number(fs.readFileSync(childPidFile));
      parent.kill("SIGKILL");
      await exited;
      process.kill(childPid, "SIGKILL");
      childPid = null;
      expect(executionStatus(s.repo, s.registry, ID).status).toBe("uncertain");
      expect(executeOnce(s.repo, s.registry, ID, { binary: "/must/not/run" }).status).toBe(
        "uncertain",
      );
      // Only after stopping the old child, the supervisor certifies the preserved bytes.
      const recovery = spawnSync(
        process.execPath,
        ["scripts/studio-flow-minimal.mjs", "certify", s.repo, s.registry, ID],
        { encoding: "utf8" },
      );
      expect(recovery.status).toBe(0);
      expect(JSON.parse(recovery.stdout).passed).toBe(true);
    } finally {
      parent.kill("SIGKILL");
      if (childPid) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          /* already stopped */
        }
      }
    }
  });
});
