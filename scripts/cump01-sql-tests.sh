#!/usr/bin/env bash
# CUMP-01 · runs the birthday SQL checks on a disposable LOCAL PostgreSQL database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/cump01-sql-tests.sh
# Never point it at Sandbox or production: it drops and recreates the database "cump01_test".
set -euo pipefail
cd "$(dirname "$0")/.."
DB=cump01_test
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { PGOPTIONS="-c check_function_bodies=off" psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1" >/dev/null; }
run tests/fixtures/cump01-test-doubles.sql
for migration in \
  20261020163648_birthday_whatsapp_notifications \
  20261023100000_birthday_passes \
  20261023100500_birthday_pass_snapshot_day \
  20261023101000_birthday_gift_v1; do
  run "supabase/migrations/$migration.sql"
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -At -f tests/cump01-birthday.sql | tail -"${CUMP_TAIL:-1}"
