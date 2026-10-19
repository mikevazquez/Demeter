import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { reserve, certify } from "../../scripts/studio-flow-minimal.mjs";
import { publishDraftOnce } from "../../scripts/automation/codex-executor.mjs";
import {
  claimExecution,
  claimPublication,
  verifyExecutionOwner,
} from "../../scripts/automation/execution-claim.mjs";
const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});
const sha = (s) => createHash("sha256").update(s).digest("hex");
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publication-owner-"));
  roots.push(root);
  const repo = path.join(root, "repo"),
    registry = path.join(root, "registry");
  fs.mkdirSync(repo);
  const git = (...a) => {
    const r = spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("commit", "--allow-empty", "-qm", "base");
  const task = {
    id: "publication-owner-fixture",
    baseSha: git("rev-parse", "HEAD"),
    authorization: "https://github.com/mikevazquez/Demeter/issues/318",
    goal: "harmless fixture",
    allowedPaths: ["proof.txt"],
    checks: [["node", "-e", "process.exit(0)"]],
  };
  reserve(repo, registry, task, task.id);
  fs.writeFileSync(path.join(repo, "proof.txt"), "fixture\n");
  certify(repo, registry, task.id);
  const state = JSON.parse(fs.readFileSync(path.join(registry, task.id, "reservation.json")));
  const binding = {
    id: task.id,
    baseSha: task.baseSha,
    contractSha256: state.contractSha256,
    authorization: task.authorization,
  };
  const branch = `studio-flow/minimal/${task.id}`,
    head = "c".repeat(40);
  let count = 0;
  const refs = new Map(),
    tags = new Map();
  const pulls = [];
  const posts = [];
  const request = (m, p, b) => {
    if (m === "POST") posts.push({ p, b });
    if (p.endsWith("/git/tags") && m === "POST") {
      const s = (++count).toString(16).padStart(40, "0");
      const t = { sha: s, message: b.message, object: { sha: b.object, type: b.type } };
      tags.set(s, t);
      return t;
    }
    if (p.endsWith("/git/refs") && m === "POST") {
      if (refs.has(b.ref)) throw Object.assign(new Error("conflict"), { httpStatus: 422 });
      const r = { ref: b.ref, object: { sha: b.sha, type: "tag" } };
      refs.set(b.ref, r);
      return r;
    }
    if (p.includes("/git/ref/heads/")) {
      return { object: { sha: p.endsWith("/heads/main") ? task.baseSha : head } };
    }
    if (p.includes("/git/ref/tags/")) {
      const key = "refs/tags/" + p.split("/git/ref/tags/")[1];
      if (!refs.has(key)) throw Object.assign(new Error("missing"), { httpStatus: 404 });
      return refs.get(key);
    }
    if (p.includes("/git/tags/")) return tags.get(p.split("/").at(-1));
    if (p.includes("/pulls?")) return pulls;
    if (p.includes("/git/commits/"))
      return { sha: head, parents: [{ sha: task.baseSha }], tree: { sha: "d".repeat(40) } };
    if (p.includes("/compare/")) return { files: [{ filename: "proof.txt" }] };
    if (p.includes("/git/trees/"))
      return {
        truncated: false,
        tree: [{ path: "proof.txt", mode: "100644", type: "blob", sha: "e".repeat(40) }],
      };
    if (p.includes("/git/blobs/"))
      return { encoding: "base64", content: Buffer.from("fixture\n").toString("base64") };
    if (p.endsWith("/pulls") && m === "POST") {
      const pr = {
        head: { ref: branch, sha: head, repo: { full_name: "mikevazquez/Demeter" } },
        base: { ref: "main", repo: { full_name: "mikevazquez/Demeter" } },
        html_url: "https://github.com/mikevazquez/Demeter/pull/999999",
        state: "open",
        draft: b.draft,
      };
      pulls.push(pr);
      return pr;
    }
    throw new Error("Unimplemented fixture route " + p);
  };
  const owner = claimExecution(binding, { request, nonce: "execution-owner" });
  fs.mkdirSync(path.join(registry, task.id, "executor"));
  fs.writeFileSync(
    path.join(registry, task.id, "executor", "remote-claim.json"),
    JSON.stringify(owner),
  );
  return {
    root,
    repo,
    registry,
    task,
    binding,
    owner,
    request,
    refs,
    tags,
    pulls,
    posts,
    metadata: { baseBranch: "main", title: "Fixture", body: "Test only" },
  };
}
describe("publication ownership with real local certification and explicit GitHub doubles", () => {
  it("creates one Draft and recovers/repeats the same receipt without another POST", () => {
    const s = setup();
    const result = publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, {
      request: s.request,
    });
    expect(result.status).toBe("published-draft");
    expect(
      publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, { request: s.request }),
    ).toEqual(result);
    expect(s.posts.filter((x) => x.p.endsWith("/pulls"))).toHaveLength(1);
    expect(fs.existsSync(path.join(s.registry, "active.json"))).toBe(false);
  });
  it("rejects wrong, moved or tampered execution ownership before any publication write", () => {
    for (const mode of ["nonce", "ref", "contract", "base"]) {
      const s = setup();
      const before = s.posts.length;
      if (mode === "ref") s.refs.get(s.owner.ref).object.sha = "f".repeat(40);
      else {
        const p = path.join(s.registry, s.task.id, "executor", "remote-claim.json");
        const o = JSON.parse(fs.readFileSync(p));
        o[mode === "nonce" ? "ownerNonce" : mode === "contract" ? "contractSha256" : "baseSha"] =
          "bad";
        fs.writeFileSync(p, JSON.stringify(o));
      }
      expect(() =>
        publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, { request: s.request }),
      ).toThrow();
      expect(s.posts).toHaveLength(before);
    }
  });
  it("recovers an accepted POST whose response was lost without repeating creation", () => {
    const s = setup();
    const request = (m, p, b) => {
      const out = s.request(m, p, b);
      if (m === "POST" && p.endsWith("/pulls")) throw new Error("response lost");
      return out;
    };
    expect(() => publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, { request })).toThrow(
      "uncertain",
    );
    expect(
      publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, { request: s.request }).status,
    ).toBe("published-draft");
    expect(s.posts.filter((x) => x.p.endsWith("/pulls"))).toHaveLength(1);
  });
  it("blocks repeated creation when a failed POST left no observed PR", () => {
    const s = setup();
    let attempts = 0;
    const request = (m, p, b) => {
      if (m === "POST" && p.endsWith("/pulls")) {
        attempts++;
        throw new Error("timeout");
      }
      return s.request(m, p, b);
    };
    expect(() => publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, { request })).toThrow(
      "uncertain",
    );
    expect(publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, { request }).status).toBe(
      "blocked-publication",
    );
    expect(attempts).toBe(1);
  });
  it("blocks creation after a lost acknowledgement of the publication claim", () => {
    const s = setup();
    const request = (m, p, b) => {
      const out = s.request(m, p, b);
      if (m === "POST" && p.endsWith("/refs")) throw new Error("lost claim response");
      return out;
    };
    expect(() => publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, { request })).toThrow(
      "not acknowledged",
    );
    expect(
      publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, { request: s.request }).status,
    ).toBe("blocked-publication");
    expect(s.posts.filter((x) => x.p.endsWith("/pulls"))).toHaveLength(0);
  });
  it("does not create from changed bytes, changed parent, paths, modes or target", () => {
    for (const mode of ["bytes", "parent", "paths", "mode", "target"]) {
      const s = setup();
      const request = (m, p, b) => {
        const out = s.request(m, p, b);
        if (mode === "bytes" && p.includes("/git/blobs/"))
          return { ...out, content: Buffer.from("wrong").toString("base64") };
        if (mode === "parent" && p.includes("/git/commits/"))
          return { ...out, parents: [{ sha: "f".repeat(40) }] };
        if (mode === "paths" && p.includes("/compare/"))
          return { files: [{ filename: "unexpected.txt" }] };
        if (mode === "mode" && p.includes("/git/trees/"))
          return { ...out, tree: [{ ...out.tree[0], mode: "120000" }] };
        if (mode === "target" && p.endsWith("/heads/main"))
          return { object: { sha: "f".repeat(40) } };
        return out;
      };
      const before = s.posts.length;
      expect(() =>
        publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, { request }),
      ).toThrow();
      expect(s.posts).toHaveLength(before);
    }
  });
  it("rejects closed, non-Draft, duplicate and unrelated remote PRs without replacement", () => {
    for (const mode of ["closed", "ready", "duplicate", "unrelated"]) {
      const s = setup();
      publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, { request: s.request });
      if (mode === "closed") s.pulls[0].state = "closed";
      if (mode === "ready") s.pulls[0].draft = false;
      if (mode === "duplicate") s.pulls.push({ ...s.pulls[0] });
      if (mode === "unrelated") s.pulls[0].base.ref = "other";
      const before = s.posts.length;
      expect(() =>
        publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, { request: s.request }),
      ).toThrow();
      expect(s.posts).toHaveLength(before);
    }
  });
  it("does not treat a failed remote read as an absent publication claim", () => {
    const s = setup();
    const before = s.posts.length;
    const request = (m, p, b) => {
      if (p.includes("publication-claims/"))
        throw Object.assign(new Error("unavailable"), { httpStatus: 403 });
      return s.request(m, p, b);
    };
    expect(() => publishDraftOnce(s.repo, s.registry, s.task.id, s.metadata, { request })).toThrow(
      "unavailable",
    );
    expect(s.posts).toHaveLength(before);
  });
  it("consumes matching publication owners rather than granting a second permission", () => {
    const s = setup();
    const digest = sha("candidate");
    expect(verifyExecutionOwner(s.binding, s.owner, { request: s.request }).ownerNonce).toBe(
      "execution-owner",
    );
    expect(
      claimPublication(s.binding, s.owner, digest, { request: s.request, nonce: "publication-one" })
        .status,
    ).toBe("acquired");
    expect(
      claimPublication(s.binding, s.owner, digest, { request: s.request, nonce: "publication-one" })
        .status,
    ).toBe("consumed");
  });
});
