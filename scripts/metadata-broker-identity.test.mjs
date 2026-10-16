import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  authenticateController,
  loadGitHubPublicKeys,
  OIDC_ISSUER,
  OIDC_AUDIENCE,
  OIDC_JWKS_URL,
} from "./metadata-broker-identity.mjs";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "fixture",
  use: "sig",
  alg: "RS256",
};
const keys = { keys: [jwk] };
const at = new Date("2026-10-16T13:00:00.000Z");
const seconds = at.getTime() / 1000;
const sha = "a".repeat(40);
const claims = () => ({
  iss: OIDC_ISSUER,
  aud: OIDC_AUDIENCE,
  sub: "repo:mikevazquez/Demeter:environment:sf-gov-schema-capture",
  repository: "mikevazquez/Demeter",
  repository_id: "1370494017",
  repository_owner_id: "55609925",
  environment: "sf-gov-schema-capture",
  ref: "refs/heads/governance/sf-gov-001-controller",
  ref_type: "branch",
  ref_protected: "true",
  event_name: "push",
  runner_environment: "github-hosted",
  run_attempt: "1",
  run_id: "1234",
  sha,
  workflow_sha: sha,
  workflow_ref:
    "mikevazquez/Demeter/.github/workflows/schema-controller.yml@refs/heads/governance/sf-gov-001-controller",
  iat: seconds,
  nbf: seconds - 5,
  exp: seconds + 300,
  jti: "fixture-token-id",
});
function token(
  c = claims(),
  h = { alg: "RS256", kid: "fixture", typ: "JWT" },
  key = privateKey,
) {
  const input = [h, c]
    .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
    .join(".");
  return (
    input +
    "." +
    sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")
  );
}
const verify = (t) =>
  authenticateController(t, keys, { controller_sha: sha }, at);
test("verified RS256 identity returns limited claims without a bearer token", () => {
  const r = verify(token());
  assert.equal(r.controller_sha, sha);
  assert.equal(r.run_id, "1234");
  assert.deepEqual(Object.keys(r).sort(), [
    "controller_sha",
    "expires_at",
    "run_attempt",
    "run_id",
  ]);
  assert.ok(Object.isFrozen(r));
});
for (const [field, value] of Object.entries({
  iss: "https://evil.example",
  aud: ["sf-gov-metadata-broker-v1"],
  repository: "attacker/Demeter",
  repository_id: "2",
  repository_owner_id: "2",
  environment: "production",
  ref: "refs/pull/311/merge",
  ref_protected: "false",
  event_name: "pull_request_target",
  runner_environment: "self-hosted",
  run_attempt: "2",
  sha: "b".repeat(40),
  workflow_sha: "b".repeat(40),
  workflow_ref:
    "mikevazquez/Demeter/.github/workflows/evil.yml@refs/heads/main",
  sub: "repo:attacker/Demeter:environment:sf-gov-schema-capture",
  run_id: "1;cmd",
  jti: "",
  iat: seconds + 31,
  nbf: seconds + 1,
  exp: seconds,
})) {
  test("rejects correctly signed identity with wrong " + field, () =>
    assert.throws(
      () => verify(token({ ...claims(), [field]: value })),
      /identity denied/,
    ),
  );
}
test("rejects excessive token lifetime and malformed numeric timestamps", () => {
  for (const patch of [
    { exp: seconds + 601 },
    { iat: String(seconds) },
    { iat: seconds - 601, nbf: seconds - 610, exp: seconds + 10 },
  ])
    assert.throws(() => verify(token({ ...claims(), ...patch })), /denied/);
});
test("rejects forged signature, algorithm confusion and header URLs before any key lookup request", () => {
  const forged = token().split(".");
  forged[1] = Buffer.from(
    JSON.stringify({ ...claims(), run_id: "999" }),
  ).toString("base64url");
  assert.throws(() => verify(forged.join(".")), /denied/);
  for (const patch of [
    { alg: "none" },
    { alg: "HS256" },
    { jku: "https://evil.example" },
    { kid: "unknown" },
  ])
    assert.throws(
      () =>
        verify(
          token(claims(), {
            alg: "RS256",
            kid: "fixture",
            typ: "JWT",
            ...patch,
          }),
        ),
      /denied/,
    );
});
test("rejects duplicate key IDs, private JWK and undersized RSA keys", () => {
  for (const badKeys of [
    { keys: [jwk, jwk] },
    { keys: [{ ...jwk, d: "fake" }] },
  ])
    assert.throws(
      () =>
        authenticateController(token(), badKeys, { controller_sha: sha }, at),
      /denied/,
    );
  const weak = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const weakJwk = {
    ...weak.publicKey.export({ format: "jwk" }),
    kid: "fixture",
  };
  assert.throws(
    () =>
      authenticateController(
        token(claims(), undefined, weak.privateKey),
        { keys: [weakJwk] },
        { controller_sha: sha },
        at,
      ),
    /denied/,
  );
});
test("refuses malformed, oversized and noncanonical tokens without exposing their contents", () => {
  for (const t of ["", "fake.secret.value", token() + "=", "x".repeat(16385)])
    assert.throws(
      () => verify(t),
      (e) => e.message === "Broker identity denied",
    );
});
test("key fetch uses the pinned public URL with redirects prohibited", async () => {
  const k = await loadGitHubPublicKeys(async (url, options) => {
    assert.equal(url, OIDC_JWKS_URL);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return new Response(JSON.stringify(keys));
  });
  assert.deepEqual(k, keys);
});
test("key fetch rejects error, oversized, malformed and empty responses", async () => {
  for (const response of [
    new Response("", { status: 500 }),
    new Response("x".repeat(65537)),
    new Response("{"),
    new Response('{"keys":[]}'),
  ])
    await assert.rejects(
      loadGitHubPublicKeys(async () => response),
      (e) => e.message === "Broker identity denied",
    );
});

test("rejects reusable job redirection despite matching caller workflow", () => {
  assert.throws(
    () =>
      verify(
        token({
          ...claims(),
          job_workflow_ref: "attacker/repo/workflow.yml@main",
        }),
      ),
    /denied/,
  );
});

import { captureAuthenticatedDiagnostic } from "./metadata-broker-authenticated.mjs";
import { BROKER_QUERY_SHA256 } from "./metadata-broker-prototype.mjs";
import { REQUIRED_SCHEMA_KINDS } from "./certify-schema-parity.mjs";
function integration() {
  const request = {
    version: 1,
    candidate_sha: "c".repeat(40),
    request_id: "12345678-1234-4123-8123-123456789abc",
  };
  let reservations = 0,
    reads = 0;
  const host = {
    jwks: keys,
    now: () => at,
    reviewedAuthorization: {
      candidate_sha: request.candidate_sha,
      request_id: request.request_id,
      controller_sha: sha,
      query_sha256: BROKER_QUERY_SHA256,
      expires_at: "2026-10-16T13:01:00.000Z",
    },
    reserve: async () => {
      reservations++;
      return true;
    },
    readCatalog: async () => {
      reads++;
      return REQUIRED_SCHEMA_KINDS.map((kind) => ({
        kind,
        object_count: 1,
        fingerprint: "a".repeat(32),
      }));
    },
  };
  return { request, host, effects: () => ({ reservations, reads }) };
}
test("signed identity composes with reviewed authorization and fixed diagnostic capture", async () => {
  const f = integration();
  const result = await captureAuthenticatedDiagnostic(
    token(),
    f.request,
    f.host,
  );
  assert.deepEqual(f.effects(), { reservations: 1, reads: 2 });
  assert.equal(result.release_eligible, false);
  assert.equal(result.signature, undefined);
});
test("signed identity does not authorize another candidate or approval beyond token expiry", async () => {
  for (const mode of ["candidate", "expiry"]) {
    const f = integration();
    if (mode === "candidate") f.request.candidate_sha = "d".repeat(40);
    else f.host.reviewedAuthorization.expires_at = "2026-10-16T13:06:00.000Z";
    await assert.rejects(
      captureAuthenticatedDiagnostic(token(), f.request, f.host),
      /Authenticated broker capture denied/,
    );
    assert.deepEqual(f.effects(), { reservations: 0, reads: 0 });
  }
});
test("token expiry after reservation prevents the first catalog read", async () => {
  const f = integration();
  f.host.reserve = async () => {
    f.host.now = () => new Date("2026-10-16T13:06:00.000Z");
    return true;
  };
  // Capture one clock function that changes independently of the host property.
  let expired = false;
  f.host.now = () => (expired ? new Date("2026-10-16T13:06:00.000Z") : at);
  f.host.reserve = async () => {
    expired = true;
    return true;
  };
  await assert.rejects(
    captureAuthenticatedDiagnostic(token(), f.request, f.host),
    /Authenticated broker capture denied/,
  );
  assert.equal(f.effects().reads, 0);
});
