# Demi: duplicate WhatsApp delivery containment

## Scope and authorization

Change ID: DEMI-DUP-20261015. Baseline: `87749e84d324c6c5263c0f0128075cbe8c7e61b7`.

The user authorized continuing the correction, not production promotion. This branch contains only sender retry containment, regression tests and its own automatic deployment guard. No database migrations, credentials, customer records, prompts, bookings or notification workers are changed. Other open work remains separate.

## Verified defect

The baseline sender repeats a non-idempotent message POST up to five times after HTTP 5xx. Its shared outer policy classifies 5xx as definite non-delivery and permits another event attempt. The incident had a single captured location request, an HTTP 500/code 131000 final delivery record and visibly repeated messages. Individual copies cannot be correlated to provider IDs because the failed response supplied none; provider-internal causality remains unverified.

## Correction

The WhatsApp sender retries only explicit HTTP 429 responses inline. HTTP 408/5xx, network failures, timeouts, missing message IDs and legacy retry-exhausted outcomes require review instead of automatic event replay. Existing limits for explicit 425/429 rejection and synthetic test failures are preserved. The shared policy also becomes conservative for inbox callers; this is not a claim that all inbox transport paths were rewritten.

## Definition of Done

- Actual repository sender tests demonstrate one POST after ambiguous failure, normal success and bounded rate-limit recovery.
- Shared policy denies ambiguous outer replay, including errors marked non-retryable.
- Formatting, lint, TypeScript, test ratchet and build complete on the exact PR SHA.
- Signed webhook replay and concurrency are verified in an isolated test fixture before release.
- A safe non-production deployment is independently identified and tested; mocked transport tests are not live Meta UAT.
- Existing ambiguous error events are reviewed before any replay. The minimal sender patch does not retroactively quarantine old rows.
- Production requires separate approval and the project's release gates. No merge or promotion is authorized by this document.

## Test boundary and status

The new runtime tests execute the complete repository sender with synthetic configuration and injected transport. Global outbound fetch is denied. They do not send WhatsApp messages, call a model or write to a database. Results remain pending until CI evidence is recorded; passing local extracted-function tests is not sufficient for integration approval.

## Deployment and rollback

Automatic Git-based deployment is disabled only for this branch in `vercel.json`, preventing an unverified Preview from inheriting operational credentials. Other branches are unaffected. Do not change this guard until the target and outbound isolation are verified. The existing shared Preview is not presumed safe.

This is a code-only containment patch. Before promotion, record the current production deployment and exact SHA again. If rollback is authorized, restore that recorded deployment; restoring the baseline reintroduces the duplicate-send risk, so review or pause affected conversations rather than bulk-retrying failures. There are no schema or data rollback steps for this patch.
