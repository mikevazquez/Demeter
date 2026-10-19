# PR #317 — CI and workshop tests, 2026-10-16

Branch: `design/workshop-payment-contract-20261016`; PR https://github.com/mikevazquez/Demeter/pull/317 (**Draft, not mergeable/approved**). No production changes.

## Verified by GitHub Actions

At commit `24327f1a2ca3b8d6674f30b0e7607515fd875ba2`, workflow `Workshop Sandbox Validation`, run `38989060936`:

- **transfer-review-tests: SUCCESS**, `npx vitest run src/lib/workshops/transfer-review.test.ts`: **5/5 passed**.
- **workshop-quality: SUCCESS**: `npm ci`, `npm run lint` (0 errors, 19 warnings), `npm run typecheck`, `npm test` (**210 files, 1379 tests passed**), `npm run build` (success).

## Original global CI remains blocked

Workflow `CI`, run `38988950402`, commit `947dc84d99ed9232e839bc20ec2e181a2b104f72`: **FAILED** at `npm run format:check`, finding 28 unformatted files. Downstream steps were skipped. The supplemental workflow does not waive this formatting gate: it must pass before any merge or release.

## Still pending

- Browser UAT with genuine staff access; full approve/reject and payment receipt.
- Independent HTTP concurrency UAT with two authenticated clients.
- Demi WhatsApp integration.
- Reconcile migration history, overlapping PR #284, formatting debt, and UAT matrix before merge.
- Production promotion requires explicit `Autorizo promoción`.
