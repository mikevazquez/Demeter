import { describe, expect, it } from "vitest";
import { claimExecution } from "../../scripts/automation/execution-claim.mjs";
const task = {
  id: "authority-fixture",
  baseSha: "a".repeat(40),
  contractSha256: "b".repeat(64),
  authorization: "https://github.com/mikevazquez/Demeter/issues/318",
};
const notFound = () => Object.assign(new Error("fixture missing"), { httpStatus: 404 });
function remote() {
  let ref = null;
  let count = 0;
  const request = (method, endpoint, body) => {
    if (endpoint.includes("/pulls?")) return [];
    if (endpoint.endsWith("/tags") && method === "POST")
      return { sha: (++count).toString(16).padStart(40, "0") };
    if (method === "POST") {
      if (ref) throw Object.assign(new Error("fixture conflict"), { httpStatus: 422 });
      ref = { ref: body.ref, object: { sha: body.sha } };
      return ref;
    }
    if (!ref) throw notFound();
    return ref;
  };
  return {
    request,
    get ref() {
      return ref;
    },
  };
}
describe("remote execution consumption (explicit GitHub doubles)", () => {
  it("allows one owner and permanently consumes matching and changed contracts", () => {
    const r = remote();
    const first = claimExecution(task, { request: r.request, nonce: "owner-one" });
    expect(first.status).toBe("acquired");
    expect(claimExecution(task, { request: r.request, nonce: "owner-one" }).status).toBe(
      "consumed",
    );
    expect(
      claimExecution({ ...task, contractSha256: "c".repeat(64) }, { request: r.request }).status,
    ).toBe("consumed");
  });
  it("blocks published IDs in any PR state before attempting a write", () => {
    let writes = 0;
    const request = (m, p) => {
      if (m === "POST") writes++;
      if (p.includes("/pulls?")) {
        expect(p).toContain("state=all");
        return [{ state: "closed" }];
      }
      throw notFound();
    };
    expect(claimExecution(task, { request }).status).toBe("consumed");
    expect(writes).toBe(0);
  });
  it.each([401, 403, 429, 500, null])(
    "does not turn HTTP %s into an absent claim",
    (httpStatus) => {
      let writes = 0;
      const request = (m) => {
        if (m === "POST") writes++;
        throw Object.assign(new Error("fixture"), { httpStatus });
      };
      expect(() => claimExecution(task, { request })).toThrow();
      expect(writes).toBe(0);
    },
  );
  it("blocks when PR lookup fails or returns an incomplete response", () => {
    for (const prs of [undefined, {}]) {
      let writes = 0;
      const request = (m, p) => {
        if (m === "POST") writes++;
        if (p.includes("/pulls?")) return prs;
        throw notFound();
      };
      expect(() => claimExecution(task, { request })).toThrow("PR lookup");
      expect(writes).toBe(0);
    }
  });
  it("does not adopt a winner that raced between lookup and atomic create", () => {
    const r = remote();
    let raced = false;
    const request = (m, p, body) => {
      if (m === "POST" && p.endsWith("/refs") && !raced) {
        raced = true;
        r.request(m, p, { ...body, sha: "f".repeat(40) });
      }
      return r.request(m, p, body);
    };
    expect(() => claimExecution(task, { request })).toThrow("not acknowledged");
    expect(claimExecution(task, { request: r.request }).status).toBe("consumed");
  });
  it("does not regenerate after the server accepted a create whose response was lost", () => {
    const r = remote();
    const request = (m, p, body) => {
      const out = r.request(m, p, body);
      if (m === "POST" && p.endsWith("/refs")) throw new Error("lost response");
      return out;
    };
    expect(() => claimExecution(task, { request })).toThrow("not acknowledged");
    expect(claimExecution(task, { request: r.request }).status).toBe("consumed");
  });
  it("rejects unsafe identities before remote requests", () => {
    for (const bad of [
      { ...task, id: "../other" },
      { ...task, baseSha: "main" },
      { ...task, contractSha256: "bad" },
      { ...task, authorization: "other" },
    ]) {
      expect(() =>
        claimExecution(bad, {
          request: () => {
            throw new Error("must not request");
          },
        }),
      ).toThrow();
    }
  });
});
