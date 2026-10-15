# Governance decision core: implementation increment

This increment continues PR #294 from `ad5656dd3384c68c6c95530bdb26428cdfbc327e`.
It implements the pure evaluator and a local durable ledger. It does not replace
Codex, the admitted queue, the certification stage or the deterministic publisher.

## Implemented boundary

- `scripts/governance-evaluator.mjs`: scoped observations, policy freshness,
  admitted-issue identity, run/publication deduplication, typed refresh proposals,
  evidence classification and append-only retry/notification receipts.
- `scripts/governance-ledger.mjs`: private local POSIX journal, parent hashes,
  no-replace atomic revision publication, optimistic concurrency, history checks
  and recovery after a process restart. Corruption and interior history gaps fail closed.
- `tests/automation/governance.node.mjs`: 37 deterministic tests, including two
  actual competing Node processes and a separate-process journal read.
- `tests/governance-controller.test.ts`: runs that suite from the existing Vitest CI.
- `.github/workflows/governance-core-check.yml`: separate read-token-only check,
  no application credentials, fixture-only tests, source/TAP/formatter artifacts.
  The suite does not call external services; environment cleanup is NOT network
  isolation. Formatting changes only the disposable checkout; any diff fails
  the check and is retained for correction. No commit or push step exists.

Run locally with `node --test tests/automation/governance.node.mjs` on Node 22/Linux.
The initial local execution used Node 22.16.0: 37 passed, zero failed or skipped.
That result is not remote CI; subsequent run/commit evidence must be checked.

## Scope of GOV-01 through GOV-20

The original IDs in `docs/codex-coordinator.md` are preserved. Test names with
those IDs are decision-layer simulations or explicitly named subsets, not a new
assertion that the complete operational acceptance matrix passed.

In particular GOV-10 does not execute Codex or its fresh-runner repair; GOV-12
checks durable publication receipts, not a new interrupted GitHub publication;
GOV-17 uses simulated timestamps and process restart, not three observed scheduled
cycles. GOV-20 verifies the evaluator boundary; it is not an exhaustive adversarial
security certification. Historical executor evidence retains its original SHA.

## Trust and persistence contract

The profile and structured source observations must be constructed by a trusted
adapter from current, complete connector responses. Free-text issue instructions
are not executable actions or authority. A proposal is data only. No live adapter
or automatic ledger mutation in GitHub is enabled by these files.

Store a retry or notification claim with compare-and-swap before performing an
external effect. A stale writer must reload and reconcile; it must not retry with
a new revision blindly. An interrupted claim requires evidence-based reconciliation.
Two attempts per finding/version remain bounded across restarts. Terminal scope,
authority, quota and credential errors cannot be downgraded into transient retries.
A positive resolution receipt may close the exception but never erases its budget.
A notice receipt does not resolve a technical failure.

The local journal requires a persistent, private POSIX directory owned by the
controller. Its hash chain detects accidental corruption, not a malicious actor
who controls that directory. It is not shared storage for independent hosted
runners. Removal of a suffix of revisions cannot be detected without an external
expected-head reference. Complete snapshots are bounded to 4 MiB and history to 10,000 events;
capacity exhaustion stops writes instead of silently truncating audit history.
Production-grade archival and a shared-store adapter remain separate work.

## Remaining integration gate

Wire the existing hosted controller to the evaluator and a shared durable store,
with revision-checked writes, source completeness checks and recovery evidence.
Prove the live refresh/publication boundary and observe the required scheduled
cycles. Until then, report this increment as decision-core/local-persistence work,
not fully operational autonomous Governance. No functional Studio Flow UAT,
queue admission, permissions change, production authorization, merge or deployment
is granted by these tests.
