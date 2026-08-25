-- ADD orders.assigned_staff_id (employees.id, no FK)
-- PURPOSE: Persist installer assignment for staff without an auth.users account.
-- CONTEXT: orders.assigned_to is FK'd to auth.users(id) — it can only ever hold a
--   user_id, so staff created without a login (the normal "Yeni Montajcı Ekle" case)
--   could never be recorded there. Their assignment silently had nowhere to persist
--   before the order reached the "Montaja Hazır" step (when installation_jobs is
--   first created). This column closes that gap.
-- IDENTITY RULE (going forward):
--   orders.assigned_to            = always a user_id (auth.users FK), or NULL
--   orders.assigned_staff_id      = always an employees.id, or NULL
--   installation_jobs.assigned_staff_id = always an employees.id, or NULL
-- FK CHECK (requested before applying): employees.id is `uuid DEFAULT gen_random_uuid()
-- PRIMARY KEY` (supabase_hr_module.sql:3) — type-compatible with a FK. However a FK is
-- INTENTIONALLY NOT added here. Evidence in-repo shows installation_jobs.assigned_staff_id
-- — the column this one mirrors — has historically held raw auth user_id values, not just
-- employees.id:
--   supabase_fix_installer_duplicates.sql:56-58 explicitly repairs rows where
--     "assigned_staff_id = dupe.user_id" (a user_id, not an employees.id)
--   production_verify_installation_completion_readonly.sql:256 joins with
--     "LEFT JOIN public.employees e ON ij.assigned_staff_id = e.id" (LEFT, not INNER —
--     written expecting some rows will NOT match employees.id)
-- That dedup script only fixes rows for employees sharing a duplicate name; it is not a
-- guarantee that every legacy assigned_staff_id value in production now points at a valid
-- employees.id. Adding a FK now, without first running a live read-only audit against the
-- production database (which this session has no credentials/connection to run), risks the
-- ALTER TABLE failing outright or silently blocking future writes for any row that predates
-- this fix. So: no FK, matching the existing unconstrained installation_jobs.assigned_staff_id
-- pattern. Revisit only after a verified production audit shows zero orphaned values.
--
-- NOT a FK (see above): employees rows are also soft-deletable/company-scoped, and no
-- cross-table constraint existed for installation_jobs.assigned_staff_id either, so this
-- column intentionally mirrors that (nullable, unconstrained) pattern.
-- NO BACKFILL: existing orders.assigned_to values are left untouched; reads
-- fall back to assigned_to for old rows (see OrderDetail.tsx read priority).
-- ============================================================================

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS assigned_staff_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_orders_assigned_staff_id
    ON public.orders (assigned_staff_id);

COMMENT ON COLUMN public.orders.assigned_staff_id IS
'Always an employees.id (never a user_id). Populated for installers without an auth.users account, where orders.assigned_to (FK to auth.users) cannot be used. No FK constraint — mirrors installation_jobs.assigned_staff_id.';

NOTIFY pgrst, 'reload schema';
