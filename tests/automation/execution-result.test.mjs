import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixture } from "./fixtures/result-authority.mjs";
import {
  captureExecutionResult,
  writeExecutionResult,
  readExecutionResult,
  restoreExecution,
} from "../../scripts/automation/execution-result.mjs";
import { executeOnce, publishDraftOnce } from "../../scripts/automation/codex-executor.mjs";
const fixtures = [];
const setup = () => {
  const s = fixture();
  fixtures.push(s);
  return s;
};
afterEach(() => {
  for (const s of fixtures.splice(0)) fs.rmSync(s.root, { recursive: true, force: true });
});
const writes = (s) => s.calls.filter((x) => x.method !== "GET").length;
const files = (p) =>
  Object.fromEntries(
    fs
      .readdirSync(p, { recursive: true })
      .filter((x) => fs.statSync(path.join(p, x)).isFile())
      .map((x) => [x, fs.readFileSync(path.join(p, x), "utf8")]),
  );
describe("sealed results and recovery (explicit remote/model fixtures)", () => {
  it("restores a completed generation and replays it without invoking any model", () => {
    const s = setup();
    s.seal();
    const target = s.fresh(),
      before = writes(s);
    const restored = restoreExecution(target.repo, target.registry, s.task.id, s.identity, {
      request: s.request,
    });
    expect(restored).toMatchObject({
      status: "candidate-ready",
      registryRestored: true,
      generationAllowed: false,
    });
    expect(fs.readFileSync(path.join(target.repo, "proof.mjs"), "utf8")).toBe(
      "export const proof = true;\n",
    );
    const replay = executeOnce(target.repo, target.registry, s.task.id, {
      binary: "/must/not/execute",
      claim: () => {
        throw new Error("must not claim");
      },
    });
    expect(replay).toMatchObject({ status: "candidate-ready", sessionId: s.result.sessionId });
    expect(writes(s)).toBe(before);
    const snapshot = files(target.registry);
    restoreExecution(target.repo, target.registry, s.task.id, s.identity, { request: s.request });
    expect(files(target.registry)).toEqual(snapshot);
  });
  it("reconciles a lost accepted ref response without another write", () => {
    const s = setup();
    const request = (m, p, b) => {
      const out = s.request(m, p, b);
      if (m === "POST" && p.endsWith("/refs") && b.ref.includes("execution-results"))
        throw s.error(504);
      return out;
    };
    expect(() => writeExecutionResult(s.bundle(), { request })).toThrow("uncertain");
    const before = writes(s);
    expect(
      readExecutionResult(s.task.id, s.identity, { request: s.request }).bundle.result,
    ).toEqual(s.result);
    expect(writeExecutionResult(s.bundle(), { request: s.request }).status).toBe("recorded");
    expect(writes(s)).toBe(before);
  });
  it("rejects a different payload after a result has been sealed", () => {
    const s = setup();
    s.seal();
    const before = writes(s);
    fs.writeFileSync(path.join(s.repo, "proof.mjs"), "export const changed=true;\n");
    expect(() => writeExecutionResult(s.bundle(), { request: s.request })).toThrow("differs");
    expect(writes(s)).toBe(before);
  });
  it("does not treat 403 as permission to create a result", () => {
    const s = setup();
    const before = writes(s);
    const request = (m, p, b) => {
      if (p.includes("ref/tags/vianelis/execution-results")) throw s.error(403);
      return s.request(m, p, b);
    };
    expect(() => writeExecutionResult(s.bundle(), { request })).toThrow("403");
    expect(writes(s)).toBe(before);
  });
  it("rejects altered remote bytes before creating a local registry", () => {
    const s = setup();
    s.seal();
    const blob = [...s.blobs.values()][0];
    blob.content = Buffer.from("corrupt").toString("base64");
    const target = s.fresh();
    expect(() =>
      restoreExecution(target.repo, target.registry, s.task.id, s.identity, { request: s.request }),
    ).toThrow("hash mismatch");
    expect(fs.existsSync(target.registry)).toBe(false);
  });
  it("rejects changed ownership and expected contract", () => {
    const s = setup();
    s.seal();
    expect(() =>
      readExecutionResult(
        s.task.id,
        { ...s.identity, contractSha256: "c".repeat(64) },
        { request: s.request },
      ),
    ).toThrow("identity");
    s.refs.get(s.owner.ref).object.sha = "d".repeat(40);
    expect(() => readExecutionResult(s.task.id, s.identity, { request: s.request })).toThrow(
      "changed",
    );
  });
  it("preserves user edits, unrelated reservations and conflicting metadata", () => {
    const s = setup();
    s.seal();
    let target = s.fresh();
    fs.writeFileSync(path.join(target.repo, "proof.mjs"), "user change\n");
    expect(() =>
      restoreExecution(target.repo, target.registry, s.task.id, s.identity, { request: s.request }),
    ).toThrow("user changes");
    expect(fs.readFileSync(path.join(target.repo, "proof.mjs"), "utf8")).toBe("user change\n");
    target = s.fresh();
    fs.mkdirSync(target.registry);
    fs.writeFileSync(
      path.join(target.registry, "active.json"),
      JSON.stringify({ id: "other-task" }),
    );
    expect(() =>
      restoreExecution(target.repo, target.registry, s.task.id, s.identity, { request: s.request }),
    ).toThrow("Another task");
    expect(fs.existsSync(path.join(target.repo, "proof.mjs"))).toBe(false);
    target = s.fresh();
    fs.mkdirSync(path.join(target.registry, s.task.id, "executor"), { recursive: true });
    fs.writeFileSync(path.join(target.registry, s.task.id, "executor/intent.json"), "{}");
    expect(() =>
      restoreExecution(target.repo, target.registry, s.task.id, s.identity, { request: s.request }),
    ).toThrow("metadata conflicts");
    expect(fs.existsSync(path.join(target.repo, "proof.mjs"))).toBe(false);
  });
  it("rejects symlinks and out-of-scope or executable candidates", () => {
    const s = setup();
    fs.writeFileSync(path.join(s.repo, "other.txt"), "unexpected");
    expect(() => s.bundle()).toThrow("Out-of-scope");
    fs.unlinkSync(path.join(s.repo, "other.txt"));
    fs.chmodSync(path.join(s.repo, "proof.mjs"), 0o755);
    expect(() => s.bundle()).toThrow("Unsafe");
    fs.chmodSync(path.join(s.repo, "proof.mjs"), 0o644);
    fs.unlinkSync(path.join(s.repo, "proof.mjs"));
    fs.symlinkSync("keep.txt", path.join(s.repo, "proof.mjs"));
    expect(() => s.bundle()).toThrow("Symlink");
  });
  it("rejects symlinked recovery state without writing candidate bytes", () => {
    const s = setup();
    s.seal();
    const target = s.fresh();
    fs.mkdirSync(target.registry);
    fs.symlinkSync(s.registry + "/" + s.task.id, path.join(target.registry, s.task.id));
    expect(() =>
      restoreExecution(target.repo, target.registry, s.task.id, s.identity, { request: s.request }),
    ).toThrow("Symlink");
    expect(fs.existsSync(path.join(target.repo, "proof.mjs"))).toBe(false);
  });
  it("restores deletions and can finish an interrupted local reconstruction", () => {
    const s = setup();
    fs.unlinkSync(path.join(s.repo, "keep.txt"));
    s.seal();
    const target = s.fresh();
    restoreExecution(target.repo, target.registry, s.task.id, s.identity, { request: s.request });
    expect(fs.existsSync(path.join(target.repo, "keep.txt"))).toBe(false);
    fs.unlinkSync(path.join(target.registry, "active.json"));
    fs.unlinkSync(path.join(target.registry, s.task.id, "executor/checkpoint.json"));
    expect(
      restoreExecution(target.repo, target.registry, s.task.id, s.identity, { request: s.request })
        .registryRestored,
    ).toBe(true);
  });
  it("never reactivates a published task and verification copies cannot publish", () => {
    const s = setup();
    s.seal();
    s.setPrs([{ number: 1 }]);
    const target = s.fresh();
    expect(
      restoreExecution(target.repo, target.registry, s.task.id, s.identity, { request: s.request }),
    ).toMatchObject({ status: "reconcile-published-only", registryRestored: false });
    expect(fs.existsSync(target.registry)).toBe(false);
    restoreExecution(target.repo, target.registry, s.task.id, s.identity, {
      request: s.request,
      verificationOnly: true,
    });
    expect(() =>
      publishDraftOnce(target.repo, target.registry, s.task.id, {}, { request: s.request }),
    ).toThrow("Verification registry");
    s.setPrs([]);
    expect(() =>
      restoreExecution(target.repo, target.registry, s.task.id, s.identity, { request: s.request }),
    ).toThrow("cannot become operational");
  });
  it("rejects blocked results and oversized candidate files before remote writes", () => {
    const s = setup();
    const before = writes(s);
    const b = s.bundle();
    b.result = { ...b.result, status: "blocked" };
    expect(() => writeExecutionResult(b, { request: s.request })).toThrow("completed successful");
    expect(writes(s)).toBe(before);
    fs.writeFileSync(path.join(s.repo, "proof.mjs"), Buffer.alloc(129 * 1024));
    expect(() => captureExecutionResult(s.repo, s.state, s.intent, s.result)).toThrow(
      "Unsafe candidate",
    );
  });
});
