# SF-OS-001 / SF-GOV-001 — B02 certification status

Date: 14 October 2026. **B02 OPEN. No production promotion authorized.**

## Scope and evidence

Continue PR #278 and issue #287; preserve all history. Initial source SHA for this continuation was `b7e7a3790131e80624e0d81fa78d2c91e9ea8813`, not the older transfer SHA. CI #3351 failed formatting of the partial audit document. That document is formatted in this change. The final SHA and final CI must be recorded in issue #287 after push.

- `b02-integration-matrix.csv`: 136 source/runtime rows: 69 branch entries and all 67 deployed functions (Candidate 1, Sandbox 38, production 28). Static destinations, environment names, connection/RPC references, located guards and test status are recorded. Dynamic account destinations, provider credentials in DB/Vault and indirect dispatch remain unresolved; this inventory is not universal isolation certification.
- `b02-runtime-inventory.json`: metadata and immutable Supabase deployment bundle hashes for every function. Source inspected through read-only calls, never invoked. SDK/transport identifiers supplement literal host detection; absence of a literal URL is not absence of network access.
- `b02-cron-inventory.json`: Sandbox 19 jobs and production 16 jobs, all active when inspected. Four direct `net.http` dispatch jobs per project target engine, delivery, followups and payments. Other jobs may dispatch indirectly. No command, header or Vault credential values were retrieved. Candidate has no installed `pg_cron`, `pg_net`, `http`, `cron` or `net` schema; 29 non-internal triggers were counted. These facts do not constitute a universal egress firewall.
- **Mail divergence:** branch delivery worker `sendEmail()` returns skipped. Sandbox v33 includes `_shared/email-provider.ts` with Resend and SendGrid transports. The branch stub cannot certify the deployed mail implementation. No mail was sent, no provider configuration was decrypted.
- `b02-runtime-probe-evidence.json`: real HTTP GET to existing Candidate diagnostic, JWT absent 401, invalid JWT 401, project legacy **anon** JWT 200/PASS. Request ID `01a13c1e-7937-716c-8082-d72085b1f59e`. This authenticates the gateway/project credential, **not a signed-in user** or a role/tenant. The diagnostic performs no outbound requests. A subsequent no-email/no-phone synthetic anonymous sign-in was rejected 422 `anonymous_provider_disabled`; no user/session was created and Auth settings were not changed. See `b02-user-session-probe-evidence.json`. Its deployed source is unchanged by this continuation; bundle identity is in the runtime inventory.
- `b02-github-gate-evidence.json`: denial probe #28 has no executed steps; check annotations explicitly reject `refs/pull/278/merge` under environment branch protection. This is causal denial evidence. Required environment reviewer Mike and allowed controller branch were read back. It does not certify required human approval of a merge to main.

## Changes in the existing governance branch

- Deny provider effects in the runtime wrapper for every Vercel Preview build of this branch, even with no Candidate flag and inherited Sandbox targets.
- Close missing OpenAI receipt/copilot paths, Meta administrative requests, Meta Inbox administrative requests, Asistian probes/handshake/provider and exchange-rate fetch. Asistian policy denial is nonretryable.
- Preserve production/Sandbox runtime behavior outside Preview and Candidate. No Edge functions deployed or production configuration changed.
- Execute eight real Edge handlers under a Node adapter with the real shared policy: 32 cases deny before payload parsing, database/context access or provider calls. Adapter bypasses Supabase middleware; these are not deployed Edge/authentication tests.
- Twelve executable negatives cover new receipt/copilot/Meta/Asistian boundaries in public Candidate, server Candidate and Preview without a flag; no network transport invoked.
- Build verifier permits Candidate only for the exact governance branch, both Candidate URLs, pinned public key hash, deny flag and all three privileged/provider credentials replaced by inert markers. It rejects production targeted at Candidate. Build tests replace only the public-key trust anchor with a synthetic fixture and verify a passing baseline before independent negative mutations. A separate local verification with the actual Candidate public key passed.

## Vercel branch separation applied

Seven new Preview-only overrides were created for `governance/sf-gov-001-release-gates` in existing project `demeterbueno`. Both Supabase URLs and the public publishable key identify Candidate; service-role, OpenAI and Mercado Pago variables contain noncredential markers; Candidate deny flag is enabled. IDs and scopes are in `b02-preview-scope-evidence.json`. No global Preview variable, other branch, production variable or project was modified. No new infrastructure created.

The old deployment `dpl_6aT7YoboiArQhz36b6YJWfsTe1oF` and older deployment URLs still represent pre-isolation builds. Environment changes do not change immutable previous builds. **Do not certify old URLs or use them for UAT.** Validate the new deployment, exact Git SHA, build-gate log and live negative/smoke results before certifying branch isolation. Other Preview branches retain their previous global provider variables and are not certified.

Candidate service-role operations are deliberately disabled by target policy. A working login/E2E/admin flow is not implied by this safe deployment. Do not weaken this policy or inject service-role credentials merely to make UAT pass.

## Human gate: exact administrative action prepared

`b02-main-ruleset-proposal.json` preserves current rule scope, required quality check and all other rules; changes only required reviews to 1, dismiss stale reviews and require approval of the most recent push. No bypass actors are added. A PUT using this concrete payload was rejected with HTTP 403 `Resource not accessible by integration`. The ruleset remains unchanged and main still requires 0 approving reviews.

An administrator must apply the proposal to ruleset `24974628` and verify it. PR #278 is authored by Mike; GitHub does not permit an author to approve their own PR. A qualified human reviewer distinct from the author is needed for the PR review gate. Keep Mike's separate environment/promotion authority and do not approve negative probe runs. Never let the assistant submit an approval as a substitute for human consent.

## Remaining Definition of Done

1. Validate the new branch-scoped deployment and resolve dynamic destinations/credential references for every potentially active provider path, including deployed mail and remote-only/SDK functions. No real provider traffic.
2. Execute the diagnostic with a synthetic **user session** if required by acceptance; project anon JWT evidence is recorded separately. Do not enable anonymous sign-ins globally or send email to create a test user. Preserve/check existing synthetic identities first.
3. Approve/apply an exact safe Candidate integration delta with mocks, identity/tenant restrictions and rollback before deploying additional Edge functions. Currently only the read-only diagnostic is deployed in Candidate; no provider-route runtime/E2E certification exists.
4. Administrator applies the prepared human-review ruleset, supplies a qualified reviewer and proves rejection/approval bound to the exact SHA. Environment branch-denial evidence alone is insufficient.
5. Final CI success for the final branch SHA; safe functional UAT/E2E, regression, release manifest and rollback evidence for that same SHA. Record actual outcomes in Notion and issue #287; check DoD only when met.
6. No production promotion, production SQL/Edge/secrets, external real messages/payments, history deletion or Mirror recreation.

## Rollback and continuity

Code remains unmerged on existing PR #278. If this change needs reversal, preserve history with a revert in the branch. **Keep deny-only Preview overrides while any Candidate build is active**: deleting them would restore inherited provider/service-role secrets. No production rollback is needed because production was not modified. The user-facing production alias was read-only checked and still pointed to deployment `dpl_25n26m7uAQ5FBRkHSf2HG17sQM12`.

B03 is not started. Its user-directed scope is synthetic identities, integrations and E2E, dependent on B02 closure. The fetched truth source enumerates remaining F0–F7 requirements and does not contain an approved full numbered B04+ mapping. Preserve canonical phase/case IDs rather than inventing block numbering: governance/contracts, inventory/baseline, promotion controls, Candidate isolation/reconstruction (Mirror retired), CI/UAT/E2E, Notion traceability, observability/recovery, pilot/adoption. Production work remains separately gated by exact `Autorizo promoción`.
