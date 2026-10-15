# Governance shared-journal bridge

This increment continues the decision core of PR #294 at
`8d40adc6cd70296c026a516515768d286abe1635`. It reuses the existing coordinator,
executor, verification, repair, publisher and admitted tasks. No functional
Studio Flow block or production release is included.

## Implemented boundaries

The existing selection job reads `docs/automation/governance-state.json` from
an immutable commit on the control branch, verifies content integrity, reads the
admitted issues/PRs and active coordinator runs, then intersects the original
selection with the pure evaluator's eligible task IDs. Unknown/incomplete sources
or changed authority do not authorize execution.

After the existing report, a separate job saves changed observations to that
single journal path using a commit with the observed HEAD as its only parent and
a non-forced ref update. A competing commit causes reconciliation, not overwriting.
A lost response is read back before any retry; no automatic PATCH retry exists.
Another fresh, read-only runner recovers the exact revision returned by the writer.
No generated code, application credentials or model key enter the writer job.
The token still has repository-level contents write permission: the fixed-path
boundary is implemented in reviewed code, not claimed as a platform path ACL.

The initial empty journal is explicitly committed with the implementation. Missing
or malformed subsequent state fails closed; it never silently initializes history.
The journal is data, excluded only from source formatting and validated by its own
schema/digest checks. Git history provides the shared backing; local runner files
and expiring artifacts are not the sole state store. A malicious administrator can
rewrite Git history; this is not tamper-proof storage or an availability guarantee.

No change to a finding means no journal commit. Idle-cycle timing remains in Actions
run metadata and report artifacts; the journal records transitions, not every wake.
The journal is outside the coordinator push-path triggers. GITHUB_TOKEN pushes do
not recursively start push workflows. Automatic Vercel integration is independent
and may produce a Preview; this work does not claim to prevent that integration.

## Verification contract

The original 37 tests remain. SHARED-01 through SHARED-25 cover gate scope,
shared-state round trips, idle deduplication, lost responses, missing state,
corruption, concurrent writers, append-only history, stale policy, active runs,
foreign sources, partial pagination, HTTP boundaries and independent acceptance
versus production states. These use simulated GitHub responses, not real API
calls. They are also run by the existing Vitest CI.

A real integration pass requires the same code SHA to pass CI, the upgraded
coordinator to read current sources, create or recover its shared journal, and a
fresh hosted runner to verify the exact revision. A repeat of the workflow must
retain existing PRs and avoid new generation/publication. Record exact run,
attempt, code SHA, journal HEAD, revision and artifact digests in the PR evidence.
Do not declare these checks passed based only on this document.

## Limits retained

Policy in Actions is the hosted controller's dated, hash-bound snapshot, not a
live Notion read. Snapshot renewal remains with the existing authorized hosted
controller. This bridge does not add tasks, modify queue contracts, issue new
permissions, send notices, or retry arbitrary runtime failures. Retry/notice
receipts in the core are not yet a complete adapter for all live failure modes.

The original operational GOV-01 through GOV-20 matrix is not wholly certified by
these component tests. In particular, repeated on-demand runs are not three
scheduled six-hour cycles; a fresh-runner recovery is not a service availability
guarantee. CI evidence belongs to its exact code SHA. Journal-only successor
commits preserve code identity but are not themselves advertised as CI-tested.
No main merge, database write, production deployment or real customer message
is authorized by the bridge.
