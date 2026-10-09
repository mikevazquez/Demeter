# Current V2 regression coverage

The approved V2 Intelligence release (`b62b2d0`) replaced the earlier INTEL-02–13 dashboard. The old source-string checks still required conversation cohorts, marketing attribution, expenses, peak-demand event reconstruction and the earlier decision UI. Those checks failed against the released V2 page before this change.

The replacement suite, `tests/inteligencia-v2-runtime.test.tsx`, renders the actual server component with a fixed clock and a filtering PostgREST double. Its 101 cases cover report permissions, tenant boundaries, view/period selection, commercial coverage, expiration windows, trial conversion, historical class occupancy, refunds, collections and recorded onboarding evidence. It asserts rendered values and query boundaries, rather than requiring the old variable names or UI copy.

The 70 obsolete Intelligence assertions are listed individually in `scripts/test-suite-migrations.json`. Existing migration, RLS, receiver and expense-action contracts remain in their original suites. V2 explicitly reports missing lead coverage; it does not promise the prior marketing, expense or event-cohort features.

CI still rejects new failures and undocumented test deletions. A listed retirement is accepted only when it already fails in the comparison baseline and the replacement suite executes at least as many cases, all passing. Exact test renames also require a passing replacement and cannot target a test already present in the baseline. The migration policy itself has regression tests in `tests/test-suite-migrations.test.js`.

Other reviewed updates align navigation with `/admin/notificaciones`, redirect the old Empresa URL to company settings, preserve no-shows in historical occupancy, include the coach roster process, and validate the approved recipient-aware cancellation template. The frozen student-portal blob reflects the reviewed `d6d4185` addition of booking-reason copy; authentication/session code remains unchanged. SQL grant checks ignore comments while still rejecting executable anonymous grants.

Transfer receipt confirmations now retain the warning that provisional packages may be revoked if payment is not confirmed. Other application changes in this task are formatting only. No database migrations, business writes or external notification deliveries are part of this change.
