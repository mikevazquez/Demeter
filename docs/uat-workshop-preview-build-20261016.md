# Sandbox preview build evidence — 2026-10-16

Scope: isolated branch `design/workshop-payment-contract-20261016`, Studio Flow Vercel project `demeterbueno`, team `demeter3`. No production promotion.

## Independently verified
- Deployment `dpl_4jvAiQTgA6YVhVzJCzczL2E5o12f` for commit `90adbe5faabe2246dc7ebb8367ca982598fc15ff` is READY, target preview (null, not production).
- Preview: https://demeterbueno-rc1y011g5-demeter3.vercel.app
- Vercel build log: `[deployment-env] Preview isolation verified: Studio Flow Sandbox.` The repository build gate compares preview URL to Sandbox and checks the publishable key SHA-256; its successful execution is direct evidence of correct preview isolation for these two variables.
- Build log: `Compiled successfully`, `Finished TypeScript in 2.1s`. Commit combined status: Vercel success.
- GitHub workflow runs for this exact commit: none found. Do not interpret preview build success as Vitest, lint, full UAT, or CI passed.
- Staff transfer review queue schema was installed and its access tested using simulated authenticated staff, plus unauthorized negative test; no browser review session validated.

## Still pending
- End-to-end browser test with genuine staff Sandbox account: open a workshop, inspect pending proof, reject, approve, verify one sale/payment/reservation.
- Full independent HTTP concurrency test from two authenticated clients.
- Vitest/lint/other CI checks, and integration with Demi.
- No automatic expiry schedule in place.
- Branch migration history must be reconciled with installed migrations before release.
