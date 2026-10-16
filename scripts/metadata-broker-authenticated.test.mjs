import assert from "node:assert/strict";
import test from "node:test";
import { captureAuthenticatedDiagnostic } from "./metadata-broker-authenticated.mjs";
import { BROKER_QUERY_SHA256 } from "./metadata-broker-prototype.mjs";
// An invalid token must be refused before request reservation or SQL, even if
// all the host authorization data look valid. Valid RSA claims are exercised
// by identity tests; activation still requires a real GitHub OIDC rehearsal.
test("invalid identity cannot reserve a request or call a catalog transport", async () => {
  let effects = 0;
  const request = {
    version: 1,
    candidate_sha: "a".repeat(40),
    request_id: "12345678-1234-4123-8123-123456789abc",
  };
  await assert.rejects(
    captureAuthenticatedDiagnostic("fake-token", request, {
      jwks: { keys: [] },
      now: () => new Date("2026-10-16T13:00:00.000Z"),
      reviewedAuthorization: {
        candidate_sha: request.candidate_sha,
        request_id: request.request_id,
        controller_sha: "b".repeat(40),
        query_sha256: BROKER_QUERY_SHA256,
        expires_at: "2026-10-16T13:01:00.000Z",
      },
      reserve: async () => {
        effects++;
        return true;
      },
      readCatalog: async () => {
        effects++;
        return [];
      },
    }),
    (e) => e.message === "Authenticated broker capture denied",
  );
  assert.equal(effects, 0);
});
