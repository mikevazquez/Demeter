import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { fixture } from "./fixtures/result-authority.mjs";
import {
  closeAuthBlocked,
  AUTH_REFRESH_ERROR,
} from "../../scripts/automation/execution-terminal.mjs";
import {
  reserve,
  withRegistryMutation,
  isClosedBlockedAttempt,
} from "../../scripts/studio-flow-minimal.mjs";
const fixtures = [];
afterEach(() => {
  for (const s of fixtures.splice(0)) fs.rmSync(s.root, { recursive: true, force: true });
});
function setup() {
  const s = fixture();
  fixtures.push(s);
  fs.unlinkSync(path.join(s.repo, "proof.mjs"));
  s.dir = path.join(s.registry, s.task.id);
  s.exec = path.join(s.dir, "executor");
  fs.mkdirSync(s.exec);
  s.events = [
    { type: "thread.started", thread_id: s.result.sessionId },
    { type: "turn.started" },
    { type: "error", message: AUTH_REFRESH_ERROR },
    { type: "turn.failed", error: { message: AUTH_REFRESH_ERROR } },
  ];
  s.saveEvents = () => {
    const bytes = s.events.map((x) => JSON.stringify(x)).join("\n") + "\n";
    fs.writeFileSync(path.join(s.exec, "events.jsonl"), bytes);
    s.result.eventSha256 = createHash("sha256").update(bytes).digest("hex");
    s.saveResult();
  };
  s.saveResult = () =>
    fs.writeFileSync(path.join(s.exec, "result.json"), JSON.stringify(s.result) + "\n");
  s.result.status = "blocked";
  s.result.exitCode = 1;
  s.saveEvents();
  for (const [name, value] of Object.entries({
    "remote-claim.json": s.owner,
    "checkpoint.json": s.checkpoint,
    "intent.json": s.intent,
  }))
    fs.writeFileSync(path.join(s.exec, name), JSON.stringify(value));
  s.close = (request = s.request) => closeAuthBlocked(s.repo, s.registry, s.task.id, { request });
  return s;
}
it("closes only proven pre-output auth failure, preserves consumption and permits a different reservation", () => {
  const s = setup(),
    before = fs.readFileSync(path.join(s.exec, "events.jsonl"));
  expect(s.close().status).toBe("closed-blocked");
  expect(isClosedBlockedAttempt(s.registry, s.task.id)).toBe(true);
  expect(fs.existsSync(path.join(s.dir, "published.json"))).toBe(false);
  expect(fs.existsSync(path.join(s.registry, "active.json"))).toBe(false);
  expect(() => reserve(s.repo, s.registry, s.task, s.task.id)).toThrow("already consumed");
  const next = { ...s.task, id: "explicit-next-fixture" };
  reserve(s.repo, s.registry, next, next.id);
  const calls = s.calls.length;
  expect(s.close().status).toBe("closed-blocked");
  expect(s.calls.slice(calls).every((x) => x.method === "GET")).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(s.registry, "active.json"))).id).toBe(next.id);
  expect(fs.readFileSync(path.join(s.exec, "events.jsonl"))).toEqual(before);
});
it("retains lock after accepted ref response is lost, then recovers same terminal with GET only", () => {
  const s = setup();
  const request = (m, p, b) => {
    const out = s.request(m, p, b);
    if (m === "POST" && p.endsWith("/refs")) throw s.error(504);
    return out;
  };
  expect(() => s.close(request)).toThrow("uncertain");
  expect(fs.existsSync(path.join(s.registry, "active.json"))).toBe(true);
  expect(fs.existsSync(path.join(s.dir, "terminal.json"))).toBe(false);
  const before = s.calls.length;
  s.close();
  expect(s.calls.slice(before).every((x) => x.method === "GET")).toBe(true);
});
it.each(["candidate-ready", "uncertain"])("cannot retire a %s result", (status) => {
  const s = setup();
  s.result.status = status;
  s.saveResult();
  expect(() => s.close()).toThrow("explicit blocked");
  expect(s.calls.filter((x) => x.method === "POST")).toHaveLength(2);
});
it("rejects generated commands even when a later error is authentication", () => {
  const s = setup();
  s.events.splice(2, 0, { type: "item.completed", item: { type: "command_execution" } });
  s.saveEvents();
  expect(() => s.close()).toThrow("without any model items");
});
it("rejects altered logs and candidate files", () => {
  const s = setup();
  fs.appendFileSync(path.join(s.exec, "events.jsonl"), "\n");
  expect(() => s.close()).toThrow("events changed");
  s.saveEvents();
  fs.writeFileSync(path.join(s.repo, "proof.mjs"), "output");
  expect(() => s.close()).toThrow("Clean original base");
});
it.each([
  "certificate.json",
  "executor/model-result.json",
  "executor/artifact-intent.json",
  "publication.json",
  "published.json",
])("rejects %s", (name) => {
  const s = setup();
  fs.writeFileSync(path.join(s.dir, name), "{}");
  expect(() => s.close()).toThrow("forbids terminal");
});
it("does not treat unavailable result authority as absence", () => {
  const s = setup();
  const req = (m, p, b) => {
    if (p.includes("execution-results")) throw s.error(503);
    return s.request(m, p, b);
  };
  expect(() => s.close(req)).toThrow("503");
  expect(fs.existsSync(path.join(s.registry, "active.json"))).toBe(true);
});
it("rejects existing result or PR and conflicting remote terminal", () => {
  const s = setup();
  s.refs.set(`refs/tags/vianelis/execution-results/${s.task.id}`, {});
  expect(() => s.close()).toThrow("Remote candidate");
  s.refs.delete(`refs/tags/vianelis/execution-results/${s.task.id}`);
  s.setPrs([{}]);
  expect(() => s.close()).toThrow("Existing PR");
  s.setPrs([]);
  s.close();
  const remote = s.refs.get(`refs/tags/vianelis/terminal-attempts/${s.task.id}`);
  s.tags.get(remote.object.sha).message = "{}";
  expect(() => s.close()).toThrow("Conflicting terminal");
});
it("blocks concurrent registry mutation instead of stealing any lock", () => {
  const s = setup();
  withRegistryMutation(s.registry, () => expect(() => s.close()).toThrow());
  expect(fs.existsSync(path.join(s.registry, "active.json"))).toBe(true);
});
it("rejects tampered local terminal bindings on next reservation", () => {
  const s = setup();
  s.close();
  const p = path.join(s.dir, "terminal.json"),
    t = JSON.parse(fs.readFileSync(p));
  t.record.resultSha256 = "0".repeat(64);
  fs.writeFileSync(p, JSON.stringify(t));
  const next = { ...s.task, id: "explicit-next-fixture" };
  expect(() => reserve(s.repo, s.registry, next, next.id)).toThrow("Invalid terminal");
  expect(fs.existsSync(path.join(s.registry, "active.json"))).toBe(false);
});
