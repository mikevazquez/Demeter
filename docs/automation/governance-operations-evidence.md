# Durable generation reservations

Continues PR #294 on top of `f77c1d0474d6df668e0f67817949b28f1a7ea606`.
The concurrent bounded observation-read recovery and artifact-only notices remain
intact. No journal history, queue contract, existing test, application file or
production configuration is replaced. The abandoned `407cfbcf` draft is not used.

## Boundary and acceptance

Selection is followed by `reserve-operations`, a separate journal-only writer.
Each task ID reserves its two existing generation/repair stages for one immutable
code SHA, contract hash, run and run attempt. The model jobs have read permissions;
they check that reservation and current source eligibility before each model step.
An incomplete reservation consumes the budget until explicitly reconciled. New runs,
partial reruns, snapshot renewals and contract edits cannot recycle the same task ID.
An orphan-branch recovery uses the existing provenance verifier and certifier but
grants no new generation. The deterministic publisher is unchanged.

The record job observes typed job/step results even after report failure. It stores
those results before refreshing observations, so a later source failure cannot
erase an already persisted outcome. It then reuses the existing bounded read
recovery with its stable source version and durable notice claims. A failed job
alone does not establish quota, credential or permission failure. Job status never
authorizes an automatic rerun. The report distinguishes budget blocks from unfinished
work. No notification is sent or marked delivered by this increment.

Before reserving new work, the same journal writer now inspects every unreconciled
generation lease owned by an earlier run. It accepts only the exact repository,
control branch, workflow path, source SHA, run ID and historical attempt recorded in
the lease. A terminal GitHub Actions run contributes its completed job and model-step
results plus one immutable reconciliation receipt. A later workflow rerun may expose
an older attempt, but cannot rewrite its owner identity. Active runs create no receipt;
unknown conclusions, mismatched identity and unavailable evidence fail closed.

Reconciliation never releases the lease, resets either stage, changes the contract,
or authorizes another model call. A terminal run with no task-stage job is recorded as
`interrupted-without-stage-result`; the consumed reservation remains blocked. Repeated
runs recover the existing receipt without querying or appending it again. Orphan-branch
recovery continues to use the pre-existing credential-free provenance and certification
path, and it still grants no generation budget.

`OPS-01` through `OPS-38` use synthetic contracts and an in-memory GitHub transport,
plus workflow wiring assertions. The previous core/shared/read-recovery tests remain;
the independent core suite count must be re-established on the exact changed SHA. The
executor's 29 tests remain
separate. Run all suites with Node 22. The new Vitest wrapper explicitly requests TAP.
Remote evidence must name the tested SHA, run, attempt, artifact and journal revision.
Component tests are not a claim that the entire GOV-01 through GOV-20 matrix passed.

## Safety and known limits

The fixed-path writer is reviewed code, not a GitHub path-scoped token ACL.
Two stages are not a count of provider HTTP requests or tokens, and this is not an
exactly-once network guarantee. The trusted workflow has one instance of each stage
per task/run attempt. Never rerun an old workflow to bypass the current guard.

The three existing acceptance tasks are already delivered. An idle live run verifies
wiring, reading, non-duplication and journal recovery; it does not demonstrate a new
live model call under a lease. Such a test requires its own explicitly admitted
nonfunctional contract. Do not recycle existing IDs just to obtain a green run.

Remaining: live evidence of an actually interrupted generation reservation,
provider-specific generation failure classification and a notification consumer with
real delivery receipts. The prior recorder read-recovery implementation is preserved;
it is not claimed to cover every executor failure. Three scheduled six-hour cycles
and service availability remain separate evidence requirements.
