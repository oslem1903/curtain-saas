-- ============================================================================
-- Migration 017: audit_logs şema uyumu + RLS
-- Hedef proje: perdepro (ffhmzlcsgsgjonqqhgqq) — PRODUCTION
--
-- Canlı tablo (supabase_pilot_saas_hardening.sql şeması):
--   id, company_id, actor_user_id, action, entity_table, entity_id, metadata, created_at
-- Uygulama ve RPC'ler ise (audit.ts, superAdminAudit.ts, get_company_activity,
-- intervention_concurrency) user_id / entity_type / details / ip_address yazıyor.
--
-- ÇÖZÜM (yalnızca EKLEMELİ): eksik kolonları ekle, iki isim ailesini bir
-- BEFORE INSERT trigger ile senkron tut. Mevcut veri/kolon silinmez.
-- Idempotent.
-- ============================================================================

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_id     uuid;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS details     jsonb;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS ip_address  text;

CREATE OR REPLACE FUNCTION public.audit_logs_sync_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.actor_user_id := COALESCE(NEW.actor_user_id, NEW.user_id, auth.uid());
  NEW.user_id       := COALESCE(NEW.user_id, NEW.actor_user_id);
  NEW.entity_table  := COALESCE(NEW.entity_table, NEW.entity_type);
  NEW.entity_type   := COALESCE(NEW.entity_type, NEW.entity_table);
  NEW.metadata      := COALESCE(NEW.metadata, NEW.details);
  NEW.details       := COALESCE(NEW.details, NEW.metadata);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_sync_columns ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_sync_columns
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_sync_columns();

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created
  ON public.audit_logs (company_id, created_at DESC);

-- RLS: açık değilse aç; yalnızca eksik policy'leri ekle (mevcutlara dokunma).
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_logs' AND policyname='audit_logs_select_scope') THEN
    CREATE POLICY audit_logs_select_scope ON public.audit_logs
      FOR SELECT TO authenticated
      USING (
        public.is_super_admin()
        OR company_id IN (SELECT cm.company_id FROM public.company_members cm WHERE cm.user_id = auth.uid())
      );
  END IF;

  -- INSERT: yalnızca kendi şirketi için (süper admin her şirket/NULL için).
  -- Yazan kişi kendi kimliğiyle yazmak zorunda (sahte actor engeli).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_logs' AND policyname='audit_logs_insert_scope') THEN
    CREATE POLICY audit_logs_insert_scope ON public.audit_logs
      FOR INSERT TO authenticated
      WITH CHECK (
        public.is_super_admin()
        OR (
          company_id IN (SELECT cm.company_id FROM public.company_members cm WHERE cm.user_id = auth.uid())
          AND COALESCE(actor_user_id, user_id, auth.uid()) = auth.uid()
        )
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- Doğrulama (salt okunur):
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='audit_logs' ORDER BY ordinal_position;
SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='audit_logs';
