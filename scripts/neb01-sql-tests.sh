#!/usr/bin/env bash
# NEB-01 · runs the Nébora platform SQL checks on a disposable LOCAL PostgreSQL database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/neb01-sql-tests.sh
# Never point it at Sandbox or production: it drops and recreates the database "neb01_test".
set -euo pipefail
cd "$(dirname "$0")/.."
DB=neb01_test
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1" >/dev/null; }
run tests/fixtures/neb01-test-doubles.sql
for migration in \
  20261022210000_neb01_platform_admins_audit \
  20261022211000_neb01_plans_modules_entitlements \
  20261022212000_neb01_entitlement_guards; do
  run "supabase/migrations/$migration.sql"
done
for test in tests/neb01-platform.sql tests/neb01-guards.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -At -f "$test" | tail -1
done
