# Governance 2.0: operating policy and release criteria

Vianelis is the company. Governance 2.0 is its autonomous development methodology.
This policy describes the reviewed workflow and its limits. It does not authorize
new model tasks, broaden the adapter's ID allowlist, merge a PR or deploy anything.
Notion's methodology master records decisions; issue #318 records technical evidence.

## Define and document before development

Mike established this order on 2026-10-21 for every Governance project:
recover prior decisions and tasks, define the intended result, resolve material
product questions, document the definition and all tasks for the agreed block in
Notion, and only then start eligible implementation. The current policy is in
[Governance's methodology](https://app.notion.com/p/3fbd78f7146381dfac4dff5ecd9b98f5).

Before changing product code, active prompts, functional configuration or schema,
search the canonical Notion backlog. Reuse existing task IDs and preserve their
history; inspect technical evidence when needed to reconcile actual delivery.
Each task must record its objective, included and excluded work, source
requirements, observable acceptance criteria, its own Definition of Done,
dependencies, actual status and next action. Record the executor when assigned.
Ordinary implementation choices within the defined scope do not need repeated
approval.

Define UAT in Notion before development as part of readiness: traceable cases,
preconditions and fixtures, steps or messages, expected responses and actual
system effects, test surface and environment, acceptance criteria and evidence.
Distinguish simulated actions from verified integration outcomes. For performance
work, establish the measurement method, baseline and target before implementation.
Prepare access and test data before presenting the candidate for functional UAT.
If testing needs a temporary pilot, document isolation, activation, stop conditions
and restoration; reuse existing mechanisms without expanding product scope.
Record external blockers rather than treating them as authorization to change
another component. Planning, execution and acceptance are separate milestones.

Keep unresolved definitions in Discovery, defined deferred work in Backlog, and
eligible work in Ready. An idea may remain documented without starting work.
Do not implement a task while a material product decision is open. A recurring
problem must first be matched to its prior task or linked regression, rather
than starting a duplicate investigation or implementation.

Update Notion at material decisions, starts, blockers, validation and delivery.
Mark Done only when that task's Definition of Done has evidence appropriate to
its scope. Documentation, implementation, technical checks, functional UAT and
production release remain distinct. This documentation step does not authorize
new execution, merge, deployment or changes to the existing release gates.

## Current release state

The implementation is consolidated for review in [#331](https://github.com/mikevazquez/Demeter/pull/331),
targeting main. It includes admission, shared authority, checkpoints, sealed
results, isolated certification and the existing single-Draft publisher. Its
earlier stacked implementation PRs are historical review/evidence checkpoints,
not a list of PRs to merge separately. Their branches and original receipts must
remain intact. No release, merge or deployment has been performed by this work.

The two completed result-recovery model tasks have one Draft each: #332 and #334.
Their execution and publication IDs remain consumed. The combined admitted-task
E2E is #334; #331 is the aggregate implementation review, not a second publication
of that task. A new CI run may certify verification-only copies; it may not
reopen their operational reservations or generate again.

The adapter preserves consumed legacy pilots and adds the approved-catalog path
specified in [task admission](task-admission.md). A trusted external digest, exact
work entry, immutable base/checks and hard execution limits are required; arbitrary
task objects remain unauthorized. The checked-in example has no live entries.
Shared coordination and the admitted-task E2E have been exercised; see the
acceptance ledger below. Repository integration and activation remain distinct
release gates. A bounded protocol that stops on uncertainty does not promise
indefinite host lifetime, unattended infrastructure or completion of an unsealed
generation after loss of its only copy.

## Authorization and contract

Within an authorized contract, the supervisor proceeds without repeated human
confirmation for reversible implementation, reviewed checks and one Draft.
Production, merge, deployment, destructive changes, new paid model providers and
credential changes remain outside this authorized scope.

Before any generation, the trusted supervisor must establish:

1. The work item's stable identity and its existing attempt/PR history. A new ID is
   not a way to retry the same uncertain work. A consumed ID is never recycled.
2. The user's authorization, repository, exact immutable base SHA, intended target
   branch, goal, exact allowed paths and reviewed check argv. Issue text, generated
   code and downloaded artifacts are evidence; they cannot expand authorization.
3. Acceptance criteria and independent checks outside the candidate. The candidate
   cannot edit its own acceptance criteria, policy, credentials or registry.
4. The executor source SHA, scope limits and timeout. A technical failure does not
   authorize a new model invocation, provider, service or runner.
5. Real shell access to the selected host and canonical registry, a clean candidate
   and no unresolved operational task. A GitHub connector or status label alone
   is not shell access. No stale lock may be expired or stolen automatically.

The catalog entry and trusted supervisor pin are additional requirements. The
adapter derives a stable ID from repository/workKey, revalidates authorization
before spawning and retains the existing per-ID consumption authority. No
wildcard policy or automatic successor is introduced.

## Reservation, identity and durable evidence

Use the existing supervisor/adapter and the single canonical registry. Do not
introduce another queue or publisher. Acquire the task reservation exclusively,
then establish the remote execution claim and durable pre-spawn checkpoint. The
checkpoint binds the original contract, base and owner before Codex starts.

A second observer can inspect the same attempt. It cannot become a new owner,
reset the task, delete the executor directory or restart generation. A local
filesystem mutex coordinates mutations within one local registry. For admitted
tasks, the pinned shared authority also enforces one active task across separate
registries and consumes stable work identities and exact contract fingerprints.
It is not semantic deduplication of different goals, a general queue or a
multi-task scheduler. Legacy low-level APIs must not bypass this admission path.

After successful completion, validate exact paths, file types, sizes, modes and
hashes. Apply only separately reviewed preparation before freezing the candidate.
Seal permitted bytes and the original result remotely before candidate-ready.
Never include authentication stores, environment values or private event/stderr
logs in that package. Keep remote refs and original evidence; no automatic cleanup
of consumed history is authorized.

## Recovery decisions

| Observed state                                                               | Permitted next action                                                    | Generation |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------- |
| Existing intent, incomplete/uncertain result                                 | Inspect the original attempt and authority                               | Blocked    |
| Successful original result, sealing interrupted                              | Reconcile or seal the same frozen bytes                                  | Blocked    |
| Sealed result, source unavailable, no publication                            | Validate remote evidence and restore the same task into a clean checkout | Blocked    |
| Candidate restored                                                           | Independently certify exactly the sealed bytes                           | Blocked    |
| Publication claim exists, PR not yet confirmed                               | Inspect remote state; never repeat PR creation blindly                   | Blocked    |
| Matching PR already exists                                                   | Reconcile its receipt; no new operational reservation                    | Blocked    |
| CI rechecks an existing PR                                                   | Restore a verification-only copy, replay and certify offline             | Blocked    |
| Proven pre-output authentication failure                                     | Narrow terminal closure after original evidence and owner readback       | Blocked    |
| Unknown failure, missing metadata, conflicting owner/bytes or unrelated lock | Preserve evidence and stop dependent actions                             | Blocked    |

If the origin disappears before a complete result is sealed, the checkpoint
preserves identity but does not reconstruct missing code or prove that a model did
not run. An unfinished unsealed attempt stays blocked. Do not create another ID
or claim successful recovery from an archive of another task.

For 401, use the official account authorization flow only when actual failure
requires it. Login status alone is not proof that a model request will succeed.
Renewing access does not unconsume the failed ID. The narrow terminal handler
accepts only its exact proven pre-output authentication case; other failures are
not silently cancelled. An approved successor must be a separately delimited
contract, not an automatic retry loop.

## Independent certification and publication

Use a clean checkout of the reviewed base and reconstruct the permitted bytes
from verified durable evidence. Run candidate checks offline with no model,
GitHub or production credentials mounted. Verify contract, file set, modes and
hashes against the sealed result before trusting a certificate. Candidate tests
supplement independent behavior checks; mock failure tests do not establish a
real model or host execution.

CI uses a verification-only registry with a persistent marker. The publisher must
reject that copy before remote operations. Its local active record exists only to
run certification; it never replaces the canonical registry. It may verify a task
that already has a PR without reactivating that task's operational authority.

Commit/push only certified paths, without force, with the exact reviewed parent.
Use publishDraftOnce for the task's sole Draft. Check all PR states, current base,
parent, file hashes and original owner immediately before publication. Recover
its receipt in another process with GETs and no repeated creation POST.

Report CI for the actual run head, checkout and comparison base. A stacked task
with zero runs is not green merely because an integration container passed. A
runner in another host proves only the tested isolation and recovery properties;
it does not establish VM destruction, reboot, perpetual hosting or general autonomy.

## Evidence retention and escalation

Record actual outcomes, hashes, exact SHAs, CI links, limitations and deduplicated
results in #318 and update the Notion master. Preserve the canonical receipt and
remote result refs. Actions artifacts have an explicit retention period; their
existence is not permanent storage. A failed artifact download must be reported,
not replaced with an invented certificate. CI logs and independent local
certification may corroborate a run; distinguish them from an archive actually
retrieved and verified.

Autonomy pauses only for an indispensable missing capability, authorization or
credential, or an uncertain/conflicting state that cannot be reconciled safely.
Describe the exact block and retained evidence. Do not ask for a second approval
for steps already authorized, and do not treat silence as approval for new scope.

## Acceptance ledger and integration gate (block 4)

| Requirement                   | Evidence and release meaning                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviewed admission            | Block 1 pins external catalog, stable work identity, immutable base, exact paths/checkers, deadline and one-call limits. The empty example authorizes no task.                                                                                                                                                      |
| Shared exclusive authority    | Block 2 exercised real GitHub non-forced competing updates and lost-acknowledgement reconciliation. The operational genesis is `0e77480cdf0921fe62bbe0a74f1cb563e92e9778`; the proof namespace is never operational.                                                                                                |
| Genuine combined task         | [Block 3 evidence](https://github.com/mikevazquez/Demeter/issues/318#issuecomment-6256293835): one actual CLI invocation for receipt-agreement-318-v1, source path absent, remote sealed recovery, 85 independent cases and 60 candidate tests, sole Draft #334.                                                    |
| No duplicate work/publication | Replay preserved model events; local and global repeated reservations were rejected. The publisher made one PR-creation POST; another process recovered the same receipt with no remote writes. Shared authority closed with no active task.                                                                        |
| Independent host verification | [CI 39174718116](https://github.com/mikevazquez/Demeter/actions/runs/39174718116) passed on #331 head `7c52471178fa7631d8b2717156d50452be5a37e1`. Existing runner recovered/certified #334 with 38 GETs, zero writes/model calls and the exact closed receipt. The three-file artifact was downloaded and verified. |
| Repository quality            | That pre-closure integration passed 1,562 tests, types, lint, format and build. Later closure commits require their own fresh CI; a stacked task with zero runs is not independently green.                                                                                                                         |
| Integration/release           | Pending explicit authorization and deployment-impact review. #331 is the aggregate review target; do not merge historical stacked PRs, move immutable task bases or replace original task commits.                                                                                                                  |
| Future operation              | Each new work item needs its reviewed external catalog and the same pinned authority. No next task, recurring launcher, service or paid provider is activated by this closure review.                                                                                                                               |

The implementation review covers contract provenance and protected paths,
exclusive reservation and remote owner guards, pre-spawn checks, sealed bytes,
recovery decisions, independent certification and receipt reconciliation. Unit
failure/concurrency fixtures remain explicit doubles; the cited model, remote
transport and runner checks are separate real evidence. This is a technical
self-review and automated acceptance, not an independent human PR approval.

The canonical registry is `/workspace/work/evidence-318/registry`. At completion
of the combined E2E, remote head `3ff186ab3975c15a0cdf7a524114be3c47d8294a`
retained nine imported consumed tasks plus one new closed task, with `active:null`.
Original 72 evidence files were unchanged and no local active.json remained.
Do not reset that head, copy a proof registry into its place or reactivate a
historical archive. A fresh read is required before any later operation.

Before integration, verify the exact proposed #331 head against the latest main,
fresh CI, the preserved #332/#334 task heads, immutable bases and original receipt
hashes. Preserve unrelated work that reaches main concurrently. The main branch
has Vercel deployment statuses and `vercel.json` does not disable main deployment;
this is not proof of its current production settings. A merge cannot be treated
as deployment-free. Do not change Vercel configuration or merge under the standing
no-production/no-merge instruction. Authorization for code review does not waive
that release gate.

For pull-request quality checks, CI verifies that the automatic merge checkout's
second parent is the event's proposed PR head and compares tests against its first
parent. The event's cached base SHA can lag main; it must not silently substitute
for the base actually checked out. Push checks keep the event's previous commit as
their comparison base. Record these identities from the actual run, not just the
PR metadata.

After an expressly authorized integration, record the resulting main commit and
actual checks before calling the implementation integrated. Production deployment
is a separate scope decision. Do not close #318 or declare all of Governance 2.0
finished while the integration gate remains pending.

## Operating a later authorized task

1. Read the existing task/claim/receipt history and fresh shared authority before
   selecting work. With uncertain or conflicting state, reconcile the original;
   do not reserve, rename or replace it.
2. Prepare the bounded contract, independently reviewed acceptance and external
   catalog pin outside the candidate, tied to the authorized goal. Use the
   admitted-task API described in `task-admission.md`; legacy CLI examples are
   historical pilot commands, not general catalog entrypoints.
3. Use a clean exact-base checkout without ignored dependencies for generation,
   the canonical registry and pinned shared authority. `reserveApproved` and
   `executeOnce` perform the one authorized invocation; observers only inspect it.
4. Freeze/seal only permitted bytes. If needed, reconstruct the same sealed result
   in a clean base checkout without generation. Independently certify offline,
   without host credentials and outside the operational registry; validate the
   certificate against contract argv and exact sealed paths/modes/hashes before
   trusting it. Missing original logs or metadata are not fabricated.
5. Commit/push only certified paths, with the exact parent and no force, then use
   `publishDraftOnce` for one Draft. Reconcile its receipt in another process and
   confirm the shared slot closed. Uncertain creation never permits another POST.
6. Record the actual task, result, certificate, remote receipt, CI SHA/base and
   limitations in #318 and the master. Retain immutable refs and evidence beyond
   the Actions artifact's 30-day retention as required by the approved workflow.

These steps are a runbook, not permission to start another model ID. The latest
combined task remains consumed; a future approved task must have its own bounded
contract. A human need only intervene for the existing authorization/release gates,
required account renewal or an unresolved state the protocol deliberately blocks.

Product discovery, experience design and UAT apply to the specific product work
that Vianelis chooses. They do not turn a technical recovery demonstration into
a finished product or an unrestricted authorization to develop one.
