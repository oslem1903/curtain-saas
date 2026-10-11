#!/bin/bash
# Migration 026 yerel test zinciri (CANLIDA CALISTIRMAYIN). Kullanim: ./run_all.sh <db_adi>
# Yerel PostgreSQL 16 ve "postgres" yetkili kullanici gerekir. Sonuc: PASS/FAIL satirlari.
set -e
export PGOPTIONS="-c client_min_messages=warning"
DB="$1"; [ -n "$DB" ] || { echo "db adi verin"; exit 1; }
D="$(cd "$(dirname "$0")" && pwd)"; R="$D/../../.."
P="psql -v ON_ERROR_STOP=1 -q -d $DB"
"$D/../migration_024/run_setup.sh" "$DB"
$P -f "$D/../migration_024/10_seed_legacy.sql" > /dev/null
$P -f "$D/../migration_025/15_tables_for_025.sql" > /dev/null
$P -f "$R/supabase_migration_024_self_service_signup_trial.sql" > /dev/null
$P -f "$R/supabase_migration_025_subscription_guard_extra_tables.sql" > /dev/null
$P -f "$D/40_live_state_for_026.sql" > /dev/null
$P -f "$R/supabase_migration_023_device_rpc_membership_pick.sql" > /dev/null
$P -f "$D/39_seed_026.sql" > /dev/null
echo "--- 026 oncesi acik gosterimi ---"; psql -q -d "$DB" -f "$D/38_vuln_before_026.sql"
$P -f "$R/supabase_migration_026_super_admin_access_management.sql" > /dev/null
echo "--- 026 testleri ---"; psql -q -d "$DB" -At -f "$D/41_tests_026.sql"
