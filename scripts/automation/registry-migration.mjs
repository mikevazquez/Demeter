// Read-only migration review. Never activates a historical archive or changes the registry.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { githubRequest } from "./execution-claim.mjs";
import { isClosedBlockedAttempt } from "../studio-flow-minimal.mjs";
import { verifyRegistryClosure, registryWorkFingerprint } from "./registry-authority.mjs";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
export function inspectCanonicalRegistry(registry, { request = githubRequest } = {}) {
  for (let p = path.resolve(registry); ; p = path.dirname(p)) {
    assert(!fs.lstatSync(p).isSymbolicLink(), "Linked migration source rejected");
    if (p === path.dirname(p)) break;
  }
  for (const p of ["active.json", ".mutation-lock", "verification-only.json"])
    assert(
      !fs.existsSync(path.join(registry, p)),
      "Only idle canonical registry may be reviewed for migration",
    );
  const files = {},
    history = [];
  const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  function walk(dir, output = files) {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name),
        st = fs.lstatSync(file);
      assert(!st.isSymbolicLink(), "Linked migration evidence rejected");
      if (st.isDirectory()) walk(file, output);
      else {
        assert(
          st.isFile() && st.nlink === 1 && st.size <= 8 * 1024 * 1024,
          "Unsafe migration evidence",
        );
        output[path.relative(registry, file)] = hash(fs.readFileSync(file));
      }
    }
  }
  walk(registry);
  for (const entry of fs
    .readdirSync(registry, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(registry, entry.name),
      state = read(path.join(dir, "reservation.json"));
    assert(
      state.task.id === entry.name && state.contractSha256 === hash(JSON.stringify(state.task)),
      "Migration contract changed",
    );
    const item = {
      id: state.task.id,
      baseSha: state.task.baseSha,
      contractSha256: state.contractSha256,
      authorization: state.task.authorization,
      fingerprint: registryWorkFingerprint(state.task),
    };
    if (fs.existsSync(path.join(dir, "published.json"))) {
      const receipt = read(path.join(dir, "published.json"));
      assert(
        receipt.id === item.id && receipt.contractSha256 === item.contractSha256,
        "Migration receipt identity changed",
      );
      item.closure = {
        kind: "published",
        url: receipt.url,
        commitSha: receipt.commitSha,
        branch: receipt.branch,
        draft: receipt.draft,
      };
    } else {
      assert(
        isClosedBlockedAttempt(registry, item.id),
        "Unresolved migration task; reconcile first",
      );
      const terminal = read(path.join(dir, "terminal.json"));
      item.closure = {
        kind: "auth-blocked",
        objectSha: terminal.objectSha,
        record: terminal.record,
      };
    }
    verifyRegistryClosure(item, item.closure, { request, historical: true });
    history.push(item);
  }
  // Detect changed files/locks during the review without taking or altering canonical locks.
  const before = JSON.stringify(files);
  for (const [file, digest] of Object.entries(files))
    assert(
      hash(fs.readFileSync(path.join(registry, file))) === digest,
      "Migration source changed during review",
    );
  for (const p of ["active.json", ".mutation-lock"])
    assert(!fs.existsSync(path.join(registry, p)), "Migration source became active");
  const after = {};
  walk(registry, after);
  assert(before === JSON.stringify(after), "Migration snapshot changed");
  return {
    schema: "governance2-registry-migration-review-v1",
    files,
    filesSha256: hash(JSON.stringify(files)),
    history,
    historySha256: hash(JSON.stringify(history)),
  };
}
