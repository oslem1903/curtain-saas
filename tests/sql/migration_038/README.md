# Migration 038 yerel testi

Docker/psql gerekmez; PGlite (WASM Postgres) kullanilir. Zincir (sirayla):

`tests/sql/migration_024/{00,01,02,03,04,05,06,10}_*.sql` → `migration_025/15_tables_for_025.sql` →
`supabase_migration_024_*.sql` → `supabase_migration_025_*.sql` → `migration_026/40_live_state_for_026.sql` →
`supabase_migration_023_device_rpc_membership_pick.sql` → `migration_026/39_seed_026.sql` →
`supabase_migration_026_*.sql` → `supabase_migration_027_verified_invite_completion.sql` →
`supabase_migration_038_team_members.sql` → `migration_038/10_tests.sql`

Notlar:
- `psql` meta komutlari (`\set` vb.) calistirmadan once satirdan cikarilir; hata varsa test `FAIL:` ile durur.
- 027 testi `INSERT INTO company_members ... 'row-level security'` bekler; 038 tetikleyicisi INSERT'te RLS'ten
  once calistigi icin mesaj `OWNER_ONLY` olur (yine reddedilir).
- Canlidaki gercek politikalar fixture'da yoktur; `10_tests.sql` tetikleyiciyi RLS'ten bagimsiz sinamak icin
  genis bir test politikasi ekler.
