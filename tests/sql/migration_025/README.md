# Migration 025 yerel SQL testi

Canlı veritabanına DOKUNMAZ. `../migration_024/run_setup.sh` ile yerel taklit kurulur,
ardından sırasıyla:

    psql -d <db> -f ../migration_024/10_seed_legacy.sql
    psql -d <db> -f 15_tables_for_025.sql          # canlı şemanın (2026-10-02) birebir kopyası + SECURITY DEFINER RPC'ler
    psql -d <db> -f ../../../supabase_migration_024_self_service_signup_trial.sql
    psql -d <db> -f ../../../supabase_migration_025_subscription_guard_extra_tables.sql
    psql -d <db> -f 31_tests_025.sql                # PASS/FAIL satırlarını kontrol edin

Sonuç: 43/43 PASS (yazmaların tamamı SECURITY DEFINER fonksiyonlar üzerinden).
