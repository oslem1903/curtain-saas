#!/bin/bash
# Kullanim: ./run_setup.sh <db_adi> [with_cm_trigger]
# Ardindan: psql -d <db> -f 10_seed_legacy.sql -f 11_vuln_before.sql -f 20_extra_tables.sql
#           psql -d <db> -f ../../../supabase_migration_024_self_service_signup_trial.sql
#           psql -d <db> -f 30_tests.sql   (PASS/FAIL satirlarini kontrol edin)
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
dropdb --if-exists "$1"; createdb "$1"
for f in 00_mock_supabase.sql 01_existing_schema.sql 02_writable.sql 03_tenant.sql 04_maxusers.sql 05_invites.sql 06_old_handle_new_user.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$1" -f "$DIR/$f" > /dev/null
done
if [ "$2" = "with_cm_trigger" ]; then
  psql -v ON_ERROR_STOP=1 -q -d "$1" -c "select public.install_tenant_policy('company_members', false);" > /dev/null
fi
echo "setup ok: $1 $2"
