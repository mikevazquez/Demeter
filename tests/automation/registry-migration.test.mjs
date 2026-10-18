// Disposable historical-registry fixtures, not the canonical registry.
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixture } from "./fixtures/result-authority.mjs";
import { inspectCanonicalRegistry } from "../../scripts/automation/registry-migration.mjs";
const fixtures = [];
afterEach(() => {
  for (const s of fixtures.splice(0)) fs.rmSync(s.root, { recursive: true, force: true });
});
function setup() {
  const s = fixture();
  fixtures.push(s);
  fs.unlinkSync(path.join(s.registry, "active.json"));
  const receipt = {
    id: s.task.id,
    contractSha256: s.state.contractSha256,
    url: "https://github.com/mikevazquez/Demeter/pull/999",
    branch: `studio-flow/minimal/${s.task.id}`,
    commitSha: "d".repeat(40),
    draft: true,
  };
  fs.writeFileSync(path.join(s.registry, s.task.id, "published.json"), JSON.stringify(receipt));
  s.setPrs([
    {
      html_url: receipt.url,
      state: "closed",
      draft: false,
      head: {
        ref: receipt.branch,
        sha: "e".repeat(40),
        repo: { full_name: "mikevazquez/Demeter" },
      },
    },
  ]);
  s.commits.set(receipt.commitSha, {
    sha: receipt.commitSha,
    tree: { sha: "a".repeat(40) },
    parents: [{ sha: s.task.baseSha }],
  });
  return s;
}
it("reviews original consumed evidence read-only even after historical PR advances", () => {
  const s = setup(),
    before = s.calls.length;
  const a = inspectCanonicalRegistry(s.registry, { request: s.request }),
    b = inspectCanonicalRegistry(s.registry, { request: s.request });
  expect(a).toEqual(b);
  expect(a.history).toHaveLength(1);
  expect(Object.keys(a.files)).toHaveLength(2);
  expect(a.history[0].closure.commitSha).toBe("d".repeat(40));
  expect(s.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
  expect(fs.existsSync(path.join(s.registry, "active.json"))).toBe(false);
});
it.each(["active.json", ".mutation-lock", "verification-only.json"])(
  "rejects %s rather than activating or cancelling anything",
  (name) => {
    const s = setup();
    fs.writeFileSync(path.join(s.registry, name), "{}");
    const before = s.calls.length;
    expect(() => inspectCanonicalRegistry(s.registry, { request: s.request })).toThrow(
      "idle canonical",
    );
    expect(s.calls).toHaveLength(before);
  },
);
it("rejects linked evidence, mismatched receipt and unresolved history", () => {
  const s = setup(),
    file = path.join(s.registry, s.task.id, "published.json");
  const original = fs.readFileSync(file);
  fs.unlinkSync(file);
  fs.symlinkSync(path.join(s.root, "missing"), file);
  expect(() => inspectCanonicalRegistry(s.registry, { request: s.request })).toThrow(
    "Linked migration",
  );
  fs.unlinkSync(file);
  fs.writeFileSync(
    file,
    JSON.stringify({ ...JSON.parse(original), contractSha256: "f".repeat(64) }),
  );
  expect(() => inspectCanonicalRegistry(s.registry, { request: s.request })).toThrow(
    "receipt identity",
  );
  fs.unlinkSync(file);
  expect(() => inspectCanonicalRegistry(s.registry, { request: s.request })).toThrow(
    "Unresolved migration",
  );
});
it("rejects changed/added source evidence during review without resetting it", () => {
  const s = setup();
  let changed = false;
  const request = (m, p, b) => {
    if (!changed) {
      changed = true;
      fs.writeFileSync(path.join(s.registry, "added.json"), "{}");
    }
    return s.request(m, p, b);
  };
  expect(() => inspectCanonicalRegistry(s.registry, { request })).toThrow("snapshot changed");
  expect(fs.existsSync(path.join(s.registry, "added.json"))).toBe(true);
});
