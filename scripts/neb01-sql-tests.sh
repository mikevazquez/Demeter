#!/usr/bin/env bash
# NEB-01 · runs the Nébora platform SQL checks on a disposable LOCAL PostgreSQL database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/neb01-sql-tests.sh
# Never point it at Sandbox or production: it drops and recreates the database "neb01_test".
set -euo pipefail
cd "$(dirname "$0")/.."
DB=neb01_test
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { PGOPTIONS="-c check_function_bodies=off" psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1" >/dev/null; }
run tests/fixtures/neb01-test-doubles.sql
for migration in \
  20261023150000_neb01_platform_admins_audit \
  20261023151000_neb01_plans_modules_entitlements \
  20261023152000_neb01_entitlement_guards \
  20261023153000_neb01_module_activation_requests \
  20261023154000_neb01_studio_brand_name \
  20261023155000_neb01_platform_console_reads \
  20261023156000_neb01_studio_local_time \
  20261023157000_neb01_booking_windows \
  20261023158000_neb01_student_penalties \
  20261023159000_neb01_trial_enrollment_credit \
  20261023160000_neb01_demi_reminder_timings \
  20261023161000_neb01_support_sessions \
  20261023162000_neb01_config_issues \
  20261023163000_neb01_support_requests \
  20261023164000_neb01_feature_releases \
  20261023165000_neb01_starter_templates \
  20261023166000_neb01_demi_usage \
  20261023167000_neb01_booking_pause_notice; do
  run "supabase/migrations/$migration.sql"
done
for test in tests/neb01-platform.sql tests/neb01-guards.sql tests/neb01-branding.sql tests/neb01-console.sql tests/neb01-timezone.sql tests/neb01-booking-windows.sql tests/neb01-penalties.sql tests/neb01-trial-credit.sql tests/neb01-demi-timings.sql tests/neb01-support.sql tests/neb01-config-issues.sql tests/neb01-support-requests.sql tests/neb01-feature-releases.sql tests/neb01-starter-templates.sql tests/neb01-demi-usage.sql tests/neb01-booking-pause-notice.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -At -f "$test" | tail -${NEB_TAIL:-1}
done
