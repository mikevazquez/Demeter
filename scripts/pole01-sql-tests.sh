#!/usr/bin/env bash
# POLE-01 · runs the Pole SQL checks on a disposable LOCAL PostgreSQL database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/pole01-sql-tests.sh
# Never point it at Sandbox or production: it drops and recreates the database "pole01_test".
set -euo pipefail
cd "$(dirname "$0")/.."
DB=pole01_test
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1" >/dev/null; }
run tests/fixtures/pole-test-doubles.sql
run supabase/migrations/20260922012000_evaluaciones02_progression_validation.sql
for migration in \
  20261012182710_pole_figures_domain \
  20261012182739_pole_figures_seed \
  20261012183439_pole_figures_integrity \
  20261012190000_pole_seed_sandbox_parity \
  20261020060255_catalog_c1_student_figure_progress \
  20261020214233_catalog_c2_achievement_invoker_lock_fix \
  20261020220000_pole_sandbox_parity_functions \
  20261022160000_pole01_level_map_mandatory_figures \
  20261022170000_pole01_evaluation_template_generator; do
  run "supabase/migrations/$migration.sql"
done
for test in tests/pole01-level-mandatory.sql tests/pole01-template-generator.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -At -f "$test" | tail -1
done
