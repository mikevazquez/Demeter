import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  readExecutionCheckpoint,
  writeExecutionCheckpoint,
} from "../../scripts/automation/execution-checkpoint.mjs";

// Explicit GitHub doubles. No model, real remote writes or local recovery registry.
function fixture() {
  const task = {
    id: "checkpoint-unit-318",
    goal: "Reviewed harmless fixture",
    authorization: "https://github.com/mikevazquez/Demeter/issues/318",
    baseSha: "a".repeat(40),
    allowedPaths: ["proof.mjs"],
    checks: [["node", "--check", "proof.mjs"]],
  };
  const contractSha256 = createHash("sha256").update(JSON.stringify(task)).digest("hex");
  const identity = {
    id: task.id,
    baseSha: task.baseSha,
    contractSha256,
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
  const tags = new Map([
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
  ]);
  const refs = new Map([
    [owner.ref, { ref: owner.ref, object: { sha: owner.objectSha, type: "tag" } }],
  ]);
  const calls = [];
  let count = 1;
  const error = (status) =>
    Object.assign(new Error(`fixture HTTP ${status}`), { httpStatus: status });
  const request = (method, endpoint, body) => {
    calls.push({ method, endpoint, body });
    const prefix = "repos/mikevazquez/Demeter/git/";
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
    if (method === "POST" && endpoint === prefix + "tags") {
      const sha = (++count).toString(16).padStart(40, "0");
      tags.set(sha, { sha, object: { sha: body.object, type: body.type }, message: body.message });
      return { sha };
    }
    if (method === "POST" && endpoint === prefix + "refs") {
      if (refs.has(body.ref)) throw error(422);
      const ref = { ref: body.ref, object: { sha: body.sha, type: "tag" } };
      refs.set(body.ref, ref);
      return structuredClone(ref);
    }
    throw new Error("Unexpected request in explicit fixture");
  };
  const reservation = { task, contractSha256 };
  const intent = { ...identity, mode: "supervised-cli", startedAt: "2026-10-18T04:00:00.000Z" };
  const checkpointRef = `refs/tags/vianelis/execution-checkpoints/${task.id}`;
  return {
    task,
    reservation,
    identity,
    owner,
    intent,
    refs,
    tags,
    request,
    calls,
    error,
    checkpointRef,
  };
}
const posts = (s) => s.calls.filter((c) => c.method !== "GET");

describe("durable execution checkpoint (explicit GitHub doubles)", () => {
  it("persists a reserved contract once and inspects it without local state or writes", () => {
    const s = fixture();
    const first = writeExecutionCheckpoint(s.reservation, s.owner, null, { request: s.request });
    expect(first.status).toBe("recorded");
    expect(posts(s)).toHaveLength(2);
    const repeated = writeExecutionCheckpoint(s.reservation, s.owner, null, { request: s.request });
    expect(repeated).toEqual(first);
    expect(posts(s)).toHaveLength(2);
    const observed = readExecutionCheckpoint(s.task.id, s.identity, {
      request: (method, ...args) => {
        expect(method).toBe("GET");
        return s.request(method, ...args);
      },
    });
    expect(observed).toMatchObject({
      status: "reserved",
      generationAllowed: false,
      registryRestored: false,
      action: "inspect-original-only",
    });
    expect(observed.checkpoint.task).toEqual(s.task);
  });
  it("recovers a pre-spawn intent only as uncertain, never as permission to generate", () => {
    const s = fixture();
    writeExecutionCheckpoint(s.reservation, s.owner, s.intent, { request: s.request });
    const x = readExecutionCheckpoint(s.task.id, s.identity, { request: s.request });
    expect(x).toMatchObject({
      status: "uncertain",
      generationAllowed: false,
      registryRestored: false,
    });
    expect(x.checkpoint.intent.startedAt).toBe(s.intent.startedAt);
  });
  it("rejects changed contracts, extra fields, unsafe paths and unrelated intent before writes", () => {
    for (const change of [
      { contractSha256: "c".repeat(64) },
      { task: { secret: "fixture", ...fixture().task } },
      { task: { ...fixture().task, allowedPaths: ["../proof.mjs"] } },
    ]) {
      const s = fixture();
      const reservation = { ...s.reservation, ...change };
      if (change.task)
        reservation.contractSha256 = createHash("sha256")
          .update(JSON.stringify(reservation.task))
          .digest("hex");
      expect(() =>
        writeExecutionCheckpoint(reservation, s.owner, null, { request: s.request }),
      ).toThrow();
      expect(posts(s)).toHaveLength(0);
    }
    const s = fixture();
    expect(() =>
      writeExecutionCheckpoint(
        s.reservation,
        s.owner,
        { ...s.intent, id: "unrelated" },
        { request: s.request },
      ),
    ).toThrow("intent");
    expect(posts(s)).toHaveLength(0);
  });
  it("does not treat a denied reference read as absence", () => {
    const s = fixture();
    const request = (m, p, b) => {
      if (p.includes("ref/tags/vianelis/execution-checkpoints")) throw s.error(403);
      return s.request(m, p, b);
    };
    expect(() => writeExecutionCheckpoint(s.reservation, s.owner, null, { request })).toThrow(
      "403",
    );
    expect(posts(s)).toHaveLength(0);
  });
  it("can inspect an accepted ref after its response was lost, without another write", () => {
    const s = fixture();
    const request = (m, p, b) => {
      const result = s.request(m, p, b);
      if (m === "POST" && p.endsWith("/refs")) throw s.error(504);
      return result;
    };
    expect(() => writeExecutionCheckpoint(s.reservation, s.owner, s.intent, { request })).toThrow(
      "uncertain",
    );
    expect(readExecutionCheckpoint(s.task.id, s.identity, { request: s.request }).status).toBe(
      "uncertain",
    );
    expect(posts(s)).toHaveLength(2);
  });
  it("stops on ref conflict and never replaces a different existing snapshot", () => {
    const s = fixture();
    const request = (m, p, b) => {
      if (m === "POST" && p.endsWith("/refs")) throw s.error(422);
      return s.request(m, p, b);
    };
    expect(() => writeExecutionCheckpoint(s.reservation, s.owner, null, { request })).toThrow(
      "uncertain",
    );
    expect(s.refs.has(s.checkpointRef)).toBe(false);
    writeExecutionCheckpoint(s.reservation, s.owner, null, { request: s.request });
    const count = posts(s).length;
    expect(() =>
      writeExecutionCheckpoint(s.reservation, s.owner, s.intent, { request: s.request }),
    ).toThrow("differs");
    expect(posts(s)).toHaveLength(count);
  });
  it("stops if ownership changes before the reference write", () => {
    const s = fixture();
    let ownerReads = 0;
    const request = (m, p, b) => {
      if (p.endsWith(`/ref/tags/vianelis/execution-claims/${s.task.id}`) && ++ownerReads === 2)
        s.refs.get(s.owner.ref).object.sha = "d".repeat(40);
      return s.request(m, p, b);
    };
    expect(() => writeExecutionCheckpoint(s.reservation, s.owner, null, { request })).toThrow(
      "changed",
    );
    expect(s.refs.has(s.checkpointRef)).toBe(false);
  });
  it("does not confuse an owner's 404 with an absent checkpoint", () => {
    const s = fixture();
    writeExecutionCheckpoint(s.reservation, s.owner, null, { request: s.request });
    const count = posts(s).length;
    let ownerReads = 0;
    const request = (m, p, b) => {
      if (p.endsWith(`/ref/tags/vianelis/execution-claims/${s.task.id}`) && ++ownerReads === 2)
        throw s.error(404);
      return s.request(m, p, b);
    };
    expect(() => writeExecutionCheckpoint(s.reservation, s.owner, null, { request })).toThrow(
      "404",
    );
    expect(posts(s)).toHaveLength(count);
  });
  it("rejects wrong expected identity, corrupt metadata and changed tag targets", () => {
    const s = fixture();
    const result = writeExecutionCheckpoint(s.reservation, s.owner, null, { request: s.request });
    expect(() =>
      readExecutionCheckpoint(
        s.task.id,
        { ...s.identity, contractSha256: "c".repeat(64) },
        { request: s.request },
      ),
    ).toThrow("identity");
    const tag = s.tags.get(result.objectSha);
    const original = tag.message;
    tag.message = JSON.stringify({ ...JSON.parse(original), task: { ...s.task, goal: "changed" } });
    expect(() => readExecutionCheckpoint(s.task.id, s.identity, { request: s.request })).toThrow(
      "contract changed",
    );
    tag.message = original;
    tag.object.sha = "e".repeat(40);
    expect(() => readExecutionCheckpoint(s.task.id, s.identity, { request: s.request })).toThrow(
      "base",
    );
  });
});
