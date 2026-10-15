# Governance: bounded observation-read recovery

This increment adds failure handling to the existing shared-journal recorder in
PR #294. It does not replace selection, Codex, repair, certification, publication,
the admitted queue or the hosted Notion connection.

## Operation

`scripts/governance-failures.mjs` classifies trusted transport/HTTP errors and
orchestrates the recorder's observation read. `gate` remains read-only. `record`
uses its existing fixed-path `SharedLedger` writer; no permission is added.

A healthy read creates no failure receipt and causes no extra journal commit.
For a transient timeout, 429, rate-limited 403 or 5xx:

1. Save the failure with a stable source version.
2. Respect `Retry-After`, including GitHub reset headers. Wait at most ten seconds
   in this execution; a longer deadline defers without consuming the retry.
3. Reserve the one retry in shared Git history before making another read.
4. Perform the trusted collector once and persist its success/failure receipt.
5. Recompute the governance decision from the resulting durable state.

An uncertain reservation or completion cannot free the budget. A failed journal
write stops recovery; it is never a reason to retry the collector without a
reservation. The existing store verifies non-forced writes and lost responses.
A conflict propagates for reconciliation without an automatic second PATCH.

The source version binds repository, branch, approved policy ID/version/hash and
admitted task contracts. It excludes capture/expiry dates, run IDs and journal
commits. Neither a restart nor routine freshness renewal resets the budget.
An explicit positive-evidence resolution preserves historical attempts. A completed
recovery does not grant a fresh retry budget for another failure of the same version.

401, a permission 403 and an explicitly classified quota error do not retry.
GitHub rate limits require rate-limit/Retry-After metadata to distinguish them
from permission failures. The HTTP client never inspects or emits response contents
to infer credentials, quotas or permissions. Quota classification is tested with
a typed fixture; this is not a live OpenAI quota detector.

An unsupported server deadline fails closed rather than becoming an immediate
retry. Schema, scope, source identity and integrity failures propagate through the
existing validation boundary and never authorize a recovery read.

## Notices and reports

A terminal failure, exhausted budget or interrupted reservation can create a
stable notice claim in the journal. The recorder writes it to its existing
`governance-shared-record-<sha>-<attempt>` artifact with `delivery: artifact-only`
and `sent: false`. A fresh recorder does not generate the same notice again.

No sender is implemented. No chat, email, issue comment or third-party message is
sent. A durable claim is not a delivery receipt; this increment never creates a
`notice_sent` event. Interrupted claims require evidence-based reconciliation.

The failed recorder still exits nonzero. Its `record.json` says `allowed: false`
and `verified: false`; saving a diagnostic is not successful execution. If the
journal itself is unavailable or a validation fails, the artifact explicitly
records an unverified, non-durable diagnostic without a fabricated revision or
deduplication claim. Recovery of a revision remains in the separate read-only job.

## Validation

- READ-01 through READ-16 expand to 25 tests in
  `tests/automation/governance-failures.node.mjs`: durable reservation, bounded
  waiting, restart, uncertain writes, exhausted budget, terminal errors, HTTP
  headers, stable source identity and artifact-only notices.
- SHARED-26 through SHARED-28 exercise the recorder with the existing simulated
  GitHub store: transient recovery, repeated failure and ref conflict.
- The prior 91 component/executor tests remain. Combined suite: 119 tests.
- `tests/governance-failures-controller.test.ts` runs the new suite in existing
  Vitest CI. The independent decision-core workflow also runs and retains it.
  All three subprocess wrappers request TAP explicitly, preserving their existing
  success assertion under both Node 22 and Node 24.

These injected failures run against test doubles. A successful real workflow
verifies the healthy integration and journal recovery, not a real GitHub outage,
credential failure or customer-facing UAT. Run IDs, code SHA and artifact digests
must be obtained from completed Actions executions before reporting remote success.

## Remaining limits

This handles the recorder's observation reads after its journal has been read and
its source identity verified. A failure to access that initial backend cannot
produce a durable claim in an inaccessible store. It does not retry an entire
workflow, generation, certification, publication or a selector that already failed.
The executor's existing two generation attempts remain unchanged.

The hosted controller still checks Notion and renews only the authorized snapshot
metadata. This increment does not silently admit a changed policy or issue, clear
terminal failures, deliver notices, or certify all operational GOV-01 to GOV-20
cases. Three scheduled cycles and permanent availability remain unverified.
