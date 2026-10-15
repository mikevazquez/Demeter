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

`OPS-01` through `OPS-30` use synthetic contracts and an in-memory GitHub transport,
plus workflow wiring assertions. The previous core/shared/read-recovery tests remain;
the independent core suite now includes 120 cases. The executor's 29 tests remain
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

Remaining: evidence-based reconciliation of interrupted generation reservations,
provider-specific generation failure classification and a notification consumer
with real delivery receipts. The prior recorder read-recovery implementation is
preserved; it is not claimed to cover every executor failure. Three scheduled
six-hour cycles and service availability remain separate evidence requirements.
