import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  reserveContinued,
  verifyContinuity,
  executeOnce,
  executionStatus,
  executorEnvironment,
  collectContinuity,
} from "../../scripts/automation/codex-executor.mjs";
import { certify, publicationPlan, complete } from "../../scripts/studio-flow-minimal.mjs";
import { serializeState } from "../../scripts/automation/continuity-lab.mjs";

const FIRST = 38989415241;
const SECOND = 38999999999;
const ID = `continuity-315-${FIRST}`;
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
    const source = `import {executeOnce} from ${JSON.stringify(modulePath)}; executeOnce(${JSON.stringify(s.repo)},${JSON.stringify(s.registry)},${JSON.stringify(ID)},{binary:${JSON.stringify(binary)}});`;
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
        `import {executeOnce} from ${JSON.stringify(modulePath)}; executeOnce(${JSON.stringify(s.repo)},${JSON.stringify(s.registry)},${JSON.stringify(ID)},{binary:${JSON.stringify(binary)}});`,
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
