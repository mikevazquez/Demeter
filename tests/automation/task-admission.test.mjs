// Explicit disposable repositories, GitHub authority fixture and mocked Codex process. No real model.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ calls: 0, handler: null, login: "Logged in using ChatGPT" }));
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual("node:child_process");
  return {
    ...actual,
    spawnSync: (binary, args, options) => {
      if (binary !== "codex") return actual.spawnSync(binary, args, options);
      if (args[0] === "login") return { status: 0, stdout: "", stderr: native.login };
      native.calls++;
      if (!native.handler) throw new Error("Real model forbidden in admission tests");
      return native.handler(args, options);
    },
  };
});
import { fixture } from "./fixtures/result-authority.mjs";
import {
  admitTask,
  taskIdForWork,
  validateAdmissionProof,
  validateAdmissionOutput,
} from "../../scripts/automation/task-admission.mjs";
import {
  reserveApproved,
  executeOnce,
  publishDraftOnce,
} from "../../scripts/automation/codex-executor.mjs";
import { claimExecution } from "../../scripts/automation/execution-claim.mjs";
import {
  writeExecutionCheckpoint,
  readExecutionCheckpoint,
} from "../../scripts/automation/execution-checkpoint.mjs";
import {
  writeExecutionResult,
  readExecutionResult,
  restoreExecution,
} from "../../scripts/automation/execution-result.mjs";
const fixtures = [];
const hash = (v) => createHash("sha256").update(v).digest("hex");
afterEach(() => {
  native.handler = null;
  native.calls = 0;
  native.login = "Logged in using ChatGPT";
  for (const s of fixtures.splice(0)) fs.rmSync(s.root, { recursive: true, force: true });
});
function setup() {
  const s = fixture();
  fixtures.push(s);
  fs.unlinkSync(path.join(s.repo, "proof.mjs"));
  fs.mkdirSync(path.join(s.repo, "checks"));
  s.checkSource = "console.log('explicit trusted acceptance fixture');\n";
  fs.writeFileSync(path.join(s.repo, "checks/verify.mjs"), s.checkSource);
  fs.writeFileSync(path.join(s.repo, ".gitignore"), ".env*\nnode_modules/\n");
  s.git(s.repo, "add", ".");
  s.git(s.repo, "commit", "-qm", "acceptance source");
  s.entry = {
    workKey: "issue318-independent-work",
    baseBranch: "review/base",
    goal: "Add one pure proof fixture",
    baseSha: s.git(s.repo, "rev-parse", "HEAD"),
    allowedPaths: ["proof.mjs", "other.mjs"],
    checks: [["node", "checks/verify.mjs"]],
    independentChecks: [{ argv: ["node", "checks/verify.mjs"], sourceSha256: hash(s.checkSource) }],
    limits: {
      provider: "codex-cli-chatgpt",
      maxModelInvocations: 1,
      timeoutMs: 1000,
      maxFiles: 1,
      maxTotalBytes: 1024,
    },
    startBefore: new Date(Date.now() + 86400000).toISOString(),
  };
  s.catalog = {
    schema: "governance2-task-catalog-v1",
    repository: "mikevazquez/Demeter",
    authorization: "https://github.com/mikevazquez/Demeter/issues/318",
    tasks: [s.entry],
  };
  s.catalogFile = path.join(s.root, "approved-catalog.json");
  s.pin = () => {
    fs.writeFileSync(s.catalogFile, JSON.stringify(s.catalog));
    return { path: s.catalogFile, sha256: hash(fs.readFileSync(s.catalogFile)) };
  };
  s.trusted = s.pin();
  s.reg = path.join(s.root, "admission-registry");
  s.admit = () => admitTask(s.repo, s.trusted, s.entry.workKey);
  s.reserve = () => reserveApproved(s.repo, s.reg, s.trusted, s.entry.workKey);
  s.id = taskIdForWork(s.entry.workKey);
  s.executionOptions = {
    trustedCatalog: s.trusted,
    claim: (identity) =>
      claimExecution(identity, { request: s.request, nonce: "admission-fixture-owner" }),
    checkpoint: (state, owner, intent) =>
      writeExecutionCheckpoint(state, owner, intent, { request: s.request }),
    seal: (bundle) => writeExecutionResult(bundle, { request: s.request }),
  };
  s.start = (overrides) =>
    executeOnce(s.repo, s.reg, s.id, { ...s.executionOptions, ...overrides });
  s.mockProcess = () => {
    native.handler = (_args, opts) => {
      expect(opts.timeout).toBeLessThanOrEqual(s.entry.limits.timeoutMs);
      fs.writeFileSync(path.join(opts.cwd, "proof.mjs"), "export const proof = true;\n");
      fs.writeSync(
        opts.stdio[1],
        [
          { type: "thread.started", thread_id: "explicit-admission-fixture" },
          { type: "turn.started" },
          { type: "turn.completed" },
        ]
          .map((x) => JSON.stringify(x))
          .join("\n") + "\n",
      );
      return { status: 0, signal: null };
    };
  };
  return s;
}
it("admits the exact approved contract, preserving deterministic identity and provenance", () => {
  const s = setup(),
    task = s.admit();
  expect(task.id).toBe(s.id);
  expect(task.admission.catalogSha256).toBe(s.trusted.sha256);
  expect(task.admission.baseBranch).toBe(s.entry.baseBranch);
  validateAdmissionProof(task);
  s.reserve();
  const state = JSON.parse(fs.readFileSync(path.join(s.reg, s.id, "reservation.json")));
  expect(state.task).toEqual(task);
  expect(native.calls).toBe(0);
});
it("uses one mocked process and durable admission provenance; replay needs no expired catalog", () => {
  const s = setup();
  s.reserve();
  s.mockProcess();
  const result = s.start();
  expect(result.status).toBe("candidate-ready");
  expect(native.calls).toBe(1);
  const state = JSON.parse(fs.readFileSync(path.join(s.reg, s.id, "reservation.json")));
  const expected = { baseSha: state.task.baseSha, contractSha256: state.contractSha256 };
  const cp = readExecutionCheckpoint(s.id, expected, { request: s.request });
  expect(cp.checkpoint.task.admission).toEqual(state.task.admission);
  const recovered = readExecutionResult(s.id, expected, { request: s.request });
  expect(recovered.bundle.reservation.task.admission).toEqual(state.task.admission);
  s.catalog.tasks[0].startBefore = "2000-01-01T00:00:00.000Z";
  s.pin();
  expect(executeOnce(s.repo, s.reg, s.id)).toEqual(result);
  expect(native.calls).toBe(1);
  const target = s.fresh();
  restoreExecution(target.repo, target.registry, s.id, expected, { request: s.request });
  expect(executeOnce(target.repo, target.registry, s.id)).toEqual(result);
  expect(native.calls).toBe(1);
});
it.each([
  [
    "repository",
    (s) => {
      s.catalog.repository = "other/repo";
    },
  ],
  [
    "authorization",
    (s) => {
      s.catalog.authorization = "https://example.invalid";
    },
  ],
  [
    "missing work",
    (s) => {
      s.catalog.tasks = [];
    },
  ],
  [
    "unknown field",
    (s) => {
      s.entry.deploy = true;
    },
  ],
  [
    "wildcard",
    (s) => {
      s.entry.allowedPaths = ["src/*"];
    },
  ],
  [
    "traversal",
    (s) => {
      s.entry.allowedPaths = ["../outside.mjs"];
    },
  ],
  [
    "credentials",
    (s) => {
      s.entry.allowedPaths = [".env.production"];
    },
  ],
  [
    "own policy",
    (s) => {
      s.entry.allowedPaths = ["scripts/automation/task-admission.mjs"];
    },
  ],
  [
    "own checker",
    (s) => {
      s.entry.allowedPaths = ["checks/verify.mjs"];
    },
  ],
  [
    "shell",
    (s) => {
      s.entry.checks = [["bash", "-c", "true"]];
    },
  ],
  [
    "wrong checker hash",
    (s) => {
      s.entry.independentChecks[0].sourceSha256 = "0".repeat(64);
    },
  ],
  [
    "expired",
    (s) => {
      s.entry.startBefore = "2000-01-01T00:00:00.000Z";
    },
  ],
  [
    "ambiguous deadline",
    (s) => {
      s.entry.startBefore = "2099";
    },
  ],
  [
    "credential selector",
    (s) => {
      s.entry.allowedPaths = [".npmrc"];
    },
  ],
  [
    "multiple invocations",
    (s) => {
      s.entry.limits.maxModelInvocations = 2;
    },
  ],
  [
    "paid provider",
    (s) => {
      s.entry.limits.provider = "openai-api";
    },
  ],
  [
    "timeout",
    (s) => {
      s.entry.limits.timeoutMs = 240001;
    },
  ],
  [
    "bytes",
    (s) => {
      s.entry.limits.maxTotalBytes = 262145;
    },
  ],
  [
    "file count",
    (s) => {
      s.entry.limits.maxFiles = 3;
    },
  ],
  [
    "target traversal",
    (s) => {
      s.entry.baseBranch = "../main";
    },
  ],
  [
    "duplicate work",
    (s) => {
      s.catalog.tasks.push(structuredClone(s.entry));
    },
  ],
  [
    "renamed same work",
    (s) => {
      s.catalog.tasks.push({ ...structuredClone(s.entry), workKey: "renamed-work" });
    },
  ],
])("rejects %s before reservation, authority or spawn", (_label, mutate) => {
  const s = setup();
  mutate(s);
  s.trusted = s.pin();
  const before = s.calls.length;
  expect(() => s.reserve()).toThrow();
  expect(fs.existsSync(s.reg)).toBe(false);
  expect(s.calls).toHaveLength(before);
  expect(native.calls).toBe(0);
});
it("rejects changed, unpinned, candidate-contained, linked and oversized catalogs", () => {
  const s = setup();
  fs.appendFileSync(s.catalogFile, " ");
  expect(s.admit).toThrow("hash changed");
  expect(() => admitTask(s.repo, undefined, s.entry.workKey)).toThrow("trusted SHA256");
  s.trusted = s.pin();
  const inside = path.join(s.repo, "catalog.json");
  fs.copyFileSync(s.catalogFile, inside);
  expect(() => admitTask(s.repo, { ...s.trusted, path: inside }, s.entry.workKey)).toThrow(
    "outside candidate",
  );
  const link = path.join(s.root, "linked.json");
  fs.symlinkSync(s.catalogFile, link);
  expect(() => admitTask(s.repo, { ...s.trusted, path: link }, s.entry.workKey)).toThrow(
    "symlinks",
  );
  fs.unlinkSync(link);
  fs.linkSync(s.catalogFile, link);
  expect(s.admit).toThrow("Unsafe");
  fs.unlinkSync(link);
  fs.writeFileSync(s.catalogFile, " ".repeat(1024 * 1024 + 1));
  expect(s.admit).toThrow("oversized");
});
it("revalidates the catalog immediately before spawn without consuming an executor on rejection", () => {
  const s = setup();
  s.reserve();
  fs.appendFileSync(s.catalogFile, " ");
  const before = s.calls.length;
  expect(() => s.start()).toThrow("hash changed");
  expect(native.calls).toBe(0);
  expect(s.calls).toHaveLength(before);
  expect(fs.existsSync(path.join(s.reg, s.id, "executor"))).toBe(false);
});
it("rejects missing approval, provider override, deadline and timeout overrides before spawn", () => {
  const s = setup();
  s.reserve();
  expect(() => s.start({ trustedCatalog: undefined })).toThrow("trusted SHA256");
  expect(() => s.start({ binary: "other-provider" })).toThrow("Codex CLI");
  expect(() => s.start({ timeout: 1001 })).toThrow("timeout exceeds");
  expect(native.calls).toBe(0);
});
it("does not recycle a work identity when goal/base/catalog or display naming changes", () => {
  const s = setup();
  s.reserve();
  s.entry.goal = "Changed scope";
  s.trusted = s.pin();
  expect(s.admit().id).toBe(s.id);
  expect(s.reserve).toThrow("consumed");
  s.entry.goal = "Add one pure proof fixture";
  s.entry.workKey = "renamed-work";
  s.trusted = s.pin();
  expect(s.reserve).toThrow("consumed");
  expect(fs.readdirSync(s.reg).sort()).toEqual(["active.json", s.id].sort());
});
it("enforces output byte/file limits and preserves the consumed execution after an excess", () => {
  const s = setup(),
    task = s.admit();
  expect(() =>
    validateAdmissionOutput(task, [{ contentBase64: Buffer.alloc(1025).toString("base64") }]),
  ).toThrow("byte limit");
  expect(() => validateAdmissionOutput(task, [{ deleted: true }, { deleted: true }])).toThrow(
    "file limit",
  );
  s.reserve();
  s.mockProcess();
  const base = native.handler;
  native.handler = (args, opts) => {
    const x = base(args, opts);
    fs.writeFileSync(path.join(opts.cwd, "proof.mjs"), " ".repeat(1025));
    return x;
  };
  expect(s.start).toThrow("byte limit");
  expect(native.calls).toBe(1);
  expect(s.start().status).toBe("uncertain");
  expect(native.calls).toBe(1);
});
it("rejects a publication target different from the admitted branch before remote operations", () => {
  const s = setup();
  s.reserve();
  const before = s.calls.length;
  expect(() =>
    publishDraftOnce(
      s.repo,
      s.reg,
      s.id,
      { baseBranch: "other/base", title: "x", body: "x" },
      { request: s.request },
    ),
  ).toThrow("target differs");
  expect(s.calls).toHaveLength(before);
});

it("blocks an API-key login before execution authority and never persists authentication output", () => {
  const s = setup();
  s.reserve();
  native.login = "Logged in using API key";
  const before = s.calls.length;
  expect(() => s.start()).toThrow("authenticated ChatGPT");
  expect(s.calls).toHaveLength(before);
  expect(native.calls).toBe(0);
  expect(fs.existsSync(path.join(s.reg, s.id, "executor"))).toBe(false);
});
it("rechecks authorization after checkpoint and never retries the consumed transition", () => {
  const s = setup();
  s.reserve();
  s.mockProcess();
  const checkpoint = s.executionOptions.checkpoint;
  expect(() =>
    s.start({
      checkpoint: (...args) => {
        const cp = checkpoint(...args);
        fs.appendFileSync(s.catalogFile, " ");
        return cp;
      },
    }),
  ).toThrow("hash changed");
  expect(native.calls).toBe(0);
  expect(s.start().status).toBe("uncertain");
  expect(native.calls).toBe(0);
});
it("rechecks ChatGPT authentication after checkpoint without invoking a fallback provider", () => {
  const s = setup();
  s.reserve();
  s.mockProcess();
  const checkpoint = s.executionOptions.checkpoint;
  expect(() =>
    s.start({
      checkpoint: (...args) => {
        const cp = checkpoint(...args);
        native.login = "Logged in using API key";
        return cp;
      },
    }),
  ).toThrow("authenticated ChatGPT");
  expect(native.calls).toBe(0);
  expect(s.start().status).toBe("uncertain");
});

it("rejects ignored inputs and untracked ignored output rather than hiding them from the sealed scope", () => {
  const s = setup();
  fs.writeFileSync(path.join(s.repo, ".env.fixture"), "explicit noncredential fixture");
  expect(s.admit).toThrow("ignored output");
  fs.unlinkSync(path.join(s.repo, ".env.fixture"));
  s.reserve();
  s.mockProcess();
  const base = native.handler;
  native.handler = (a, o) => {
    const r = base(a, o);
    fs.writeFileSync(path.join(o.cwd, ".env.fixture"), "explicit noncredential fixture");
    return r;
  };
  expect(s.start).toThrow("ignored output");
  expect(native.calls).toBe(1);
  expect(s.start().status).toBe("uncertain");
  expect(native.calls).toBe(1);
});

it("honors a start deadline that expires after reservation without a claim or invocation", () => {
  const s = setup();
  s.reserve();
  const before = s.calls.length;
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse(s.entry.startBefore) + 1);
  try {
    expect(s.start).toThrow("deadline expired");
  } finally {
    now.mockRestore();
  }
  expect(native.calls).toBe(0);
  expect(s.calls).toHaveLength(before);
  expect(fs.existsSync(path.join(s.reg, s.id, "executor"))).toBe(false);
});

it("preserves dirty candidates and rejects an independent checker changed after review", () => {
  const s = setup();
  fs.writeFileSync(path.join(s.repo, "keep.txt"), "user edit\n");
  expect(s.reserve).toThrow("clean candidate");
  expect(fs.readFileSync(path.join(s.repo, "keep.txt"), "utf8")).toBe("user edit\n");
  expect(fs.existsSync(s.reg)).toBe(false);
  fs.writeFileSync(path.join(s.repo, "keep.txt"), "keep\n");
  fs.writeFileSync(path.join(s.repo, "checks/verify.mjs"), "// changed checker\n");
  expect(s.reserve).toThrow("acceptance checkout changed");
  expect(native.calls).toBe(0);
});
