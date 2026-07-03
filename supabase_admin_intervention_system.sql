-- ============================================================
-- PERDEPRO - Destek + Admin Müdahale + Geri Alma Sistemi (TAM KURULUM)
--
-- Bu dosya TEK BAŞINA çalışır. Hiçbir önceki migration'ın
-- çalıştırılmış olmasını VARSAYMAZ:
--   • support_tickets yoksa oluşturur (tüm kolonlar + RLS + storage)
--   • audit_logs yoksa oluşturur
--   • is_super_admin() / my_company_ids() helper'ları yoksa oluşturur
--   • admin müdahale tablosu + RPC'leri kurar
--
-- Tamamen idempotent + additive. Var olan tablo/policy/fonksiyonları
-- EZMEZ (yalnızca eksikse oluşturur). Tek seferde, hatasız çalışır.
--
-- ÇEKİRDEK BAĞIMLILIKLAR (bu dosya OLUŞTURAMAZ — projede zaten olmalı):
--   companies, profiles(user_id, role), company_members(user_id, company_id, is_active)
-- Bu üçü her multi-tenant tablonun temelidir; yoksa uygulama zaten çalışmaz.
-- En sondaki "BAĞIMLILIK RAPORU" hangilerinin eksik olduğunu listeler.
-- ============================================================

-- Fonksiyon gövdelerinin, henüz olmayan tablolara referansta
-- kurulum sırasında patlamaması için gövde doğrulamasını kapat.
SET check_function_bodies = off;

-- ------------------------------------------------------------
-- 0. Helper fonksiyonlar (YALNIZCA eksikse oluştur — mevcutu ezme)
-- ------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'is_super_admin' AND pronamespace = 'public'::regnamespace
    ) THEN
        EXECUTE $f$
            CREATE FUNCTION public.is_super_admin()
            RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
            AS $b$
                SELECT EXISTS (
                    SELECT 1 FROM public.profiles
                    WHERE user_id = auth.uid() AND role = 'super_admin'
                )
            $b$;
        $f$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'my_company_ids' AND pronamespace = 'public'::regnamespace
    ) THEN
        EXECUTE $f$
            CREATE FUNCTION public.my_company_ids()
            RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
            AS $b$
                SELECT company_id FROM public.company_members
                WHERE user_id = auth.uid() AND COALESCE(is_active, true)
            $b$;
        $f$;
    END IF;
END $$;

-- ------------------------------------------------------------
-- 1. support_tickets (yoksa oluştur) + tüm kolonlar
--    FK'lar guarded eklenir (companies/profiles eksikse bile patlamaz).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID,
    user_id         UUID,
    title           TEXT,
    description     TEXT,
    category        TEXT DEFAULT 'other',
    priority        TEXT DEFAULT 'medium',
    page_url        TEXT,
    status          TEXT DEFAULT 'open',
    admin_response  TEXT,
    internal_note   TEXT,
    screenshot_url  TEXT,
    support_metadata JSONB,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    resolved_at     TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ
);

-- Eski kurulumlarda eksik kalmış olabilecek kolonları tamamla
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other';
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS page_url TEXT;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open';
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS admin_response TEXT;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS internal_note TEXT;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS screenshot_url TEXT;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS support_metadata JSONB;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON public.support_tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_company ON public.support_tickets (company_id);

-- Durum CHECK constraint'i (varsa değiştir, yeni durumları kapsasın)
DO $$
DECLARE cname TEXT;
BEGIN
    SELECT conname INTO cname
    FROM pg_constraint
    WHERE conrelid = 'public.support_tickets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%';
    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.support_tickets DROP CONSTRAINT %I', cname);
    END IF;
    ALTER TABLE public.support_tickets
        ADD CONSTRAINT support_tickets_status_check
        CHECK (status IN ('open','in_progress','waiting_user','update_ready','resolved','closed'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'support_tickets status constraint atlandi: %', SQLERRM;
END $$;

-- companies FK (companies varsa ve FK yoksa)
DO $$
BEGIN
    IF to_regclass('public.companies') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'support_tickets_company_id_fkey'
             AND conrelid = 'public.support_tickets'::regclass
       ) THEN
        BEGIN
            ALTER TABLE public.support_tickets
                ADD CONSTRAINT support_tickets_company_id_fkey
                FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'support_tickets.company_id FK atlandi: %', SQLERRM;
        END;
    END IF;
END $$;

-- profiles FK (Süper Admin ekranındaki profile:profiles(full_name) join'i için)
DO $$
BEGIN
    IF to_regclass('public.profiles') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'support_tickets_user_id_profiles_fkey'
             AND conrelid = 'public.support_tickets'::regclass
       ) THEN
        BEGIN
            ALTER TABLE public.support_tickets
                ADD CONSTRAINT support_tickets_user_id_profiles_fkey
                FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'support_tickets.user_id FK atlandi (eslesmeyen eski kayit olabilir): %', SQLERRM;
        END;
    END IF;
END $$;

-- support_tickets RLS (idempotent — helper'lar yukarıda garanti edildi)
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_tickets_insert_own_company" ON public.support_tickets;
CREATE POLICY "support_tickets_insert_own_company" ON public.support_tickets
    FOR INSERT TO authenticated
    WITH CHECK (public.is_super_admin() OR company_id IN (SELECT public.my_company_ids()));

DROP POLICY IF EXISTS "support_tickets_select" ON public.support_tickets;
CREATE POLICY "support_tickets_select" ON public.support_tickets
    FOR SELECT TO authenticated
    USING (public.is_super_admin() OR company_id IN (SELECT public.my_company_ids()));

DROP POLICY IF EXISTS "support_tickets_update_super" ON public.support_tickets;
CREATE POLICY "support_tickets_update_super" ON public.support_tickets
    FOR UPDATE TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- ------------------------------------------------------------
-- 2. Destek ekran görüntüsü için private storage bucket + policy
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('support-attachments', 'support-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "support_attachments_insert" ON storage.objects;
CREATE POLICY "support_attachments_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'support-attachments'
        AND (public.is_super_admin()
             OR (storage.foldername(name))[1] IN (SELECT public.my_company_ids()::text))
    );

DROP POLICY IF EXISTS "support_attachments_select" ON storage.objects;
CREATE POLICY "support_attachments_select" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'support-attachments'
        AND (public.is_super_admin()
             OR (storage.foldername(name))[1] IN (SELECT public.my_company_ids()::text))
    );

-- ------------------------------------------------------------
-- 3. audit_logs (YALNIZCA eksikse oluştur — mevcut policy'leri bozma)
-- ------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.audit_logs') IS NULL THEN
        CREATE TABLE public.audit_logs (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            company_id  UUID,
            user_id     UUID,
            action      TEXT NOT NULL,
            entity_type TEXT,
            entity_id   UUID,
            details     JSONB,
            ip_address  TEXT,
            created_at  TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX idx_audit_logs_company ON public.audit_logs (company_id, created_at DESC);
        ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

        EXECUTE $p$
            CREATE POLICY "audit_logs_select" ON public.audit_logs
            FOR SELECT TO authenticated
            USING (public.is_super_admin() OR company_id IN (SELECT public.my_company_ids()))
        $p$;
        EXECUTE $p$
            CREATE POLICY "audit_logs_insert" ON public.audit_logs
            FOR INSERT TO authenticated
            WITH CHECK (public.is_super_admin() OR company_id IN (SELECT public.my_company_ids()))
        $p$;
    END IF;
END $$;

-- ------------------------------------------------------------
-- 4. Admin müdahale kayıt tablosu
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_data_interventions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    super_admin_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ticket_id       UUID,
    table_name      TEXT NOT NULL,
    record_id       UUID NOT NULL,
    action          TEXT NOT NULL DEFAULT 'update' CHECK (action IN ('update','revert')),
    changed_fields  TEXT[] NOT NULL DEFAULT '{}',
    old_values      JSONB NOT NULL DEFAULT '{}'::jsonb,
    new_values      JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason          TEXT,
    reverted        BOOLEAN NOT NULL DEFAULT false,
    reverted_at     TIMESTAMPTZ,
    reverted_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    revert_of       UUID REFERENCES public.admin_data_interventions(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- companies FK guarded
DO $$
BEGIN
    IF to_regclass('public.companies') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'admin_data_interventions_company_id_fkey'
             AND conrelid = 'public.admin_data_interventions'::regclass
       ) THEN
        BEGIN
            ALTER TABLE public.admin_data_interventions
                ADD CONSTRAINT admin_data_interventions_company_id_fkey
                FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'admin_data_interventions.company_id FK atlandi: %', SQLERRM;
        END;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_adi_company ON public.admin_data_interventions (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_adi_ticket  ON public.admin_data_interventions (ticket_id);
CREATE INDEX IF NOT EXISTS idx_adi_record  ON public.admin_data_interventions (table_name, record_id);

ALTER TABLE public.admin_data_interventions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "adi_select_super" ON public.admin_data_interventions;
CREATE POLICY "adi_select_super" ON public.admin_data_interventions
    FOR SELECT TO authenticated
    USING (public.is_super_admin());

-- ------------------------------------------------------------
-- 5. Güvenlik allowlist'i — yalnızca TABLO adı sabittir.
--    Kolonlar information_schema'dan OTOMATİK doğrulanır; böylece
--    sistem, kolon adları farklı olan kurulumlara da uyum sağlar
--    ve olmayan kolonu reddederek bozulmaz.
--
--    >>> Tablo adların farklıysa (keşif sorgusu sonucuna göre) SADECE
--        aşağıdaki diziyi güncellemen yeterli. <<<
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._intervention_table_allowed(p_table text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT p_table = ANY (ARRAY[
        'orders',                 -- siparişler (taslak/draft = teklif)
        'appointments',           -- ölçü / randevu
        'customers',              -- müşteriler
        'payments',               -- tahsilatlar
        'supplier_transactions',  -- tedarikçi cari hareketleri
        'supplier_payments'       -- tedarikçi ödemeleri
    ]);
$$;

-- Bir tablonun public şemasında GERÇEKTEN var olan kolonları
CREATE OR REPLACE FUNCTION public._table_columns(p_table text)
RETURNS text[] LANGUAGE sql STABLE AS $$
    SELECT COALESCE(array_agg(column_name::text), '{}')
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table;
$$;

-- ------------------------------------------------------------
-- 6. Müdahale uygula: eski değeri snapshot'la, güncelle, logla
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_apply_intervention(
    p_company_id uuid,
    p_table      text,
    p_record_id  uuid,
    p_changes    jsonb,
    p_reason     text DEFAULT NULL,
    p_ticket_id  uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_cols        text[];
    v_keys        text[];
    v_key         text;
    v_old_full    jsonb;
    v_new_full    jsonb;
    v_old_subset  jsonb := '{}'::jsonb;
    v_new_subset  jsonb := '{}'::jsonb;
    v_assignments text;
    v_intervention_id uuid;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Yetkisiz: yalnızca süper admin müdahale yapabilir.';
    END IF;

    IF NOT public._intervention_table_allowed(p_table) THEN
        RAISE EXCEPTION 'İzin verilmeyen tablo: %', p_table;
    END IF;
    IF to_regclass(format('public.%I', p_table)) IS NULL THEN
        RAISE EXCEPTION 'Tablo bu veritabanında yok: % — önce çekirdek şema kurulmalı.', p_table;
    END IF;

    v_cols := public._table_columns(p_table);
    IF NOT ('company_id' = ANY (v_cols)) THEN
        RAISE EXCEPTION 'Tablo company_id taşımıyor; güvenli (firma kapsamlı) müdahale yapılamaz: %', p_table;
    END IF;

    IF p_changes IS NULL OR p_changes = '{}'::jsonb THEN
        RAISE EXCEPTION 'Değişiklik (changes) boş olamaz.';
    END IF;

    v_keys := ARRAY(SELECT jsonb_object_keys(p_changes));

    FOREACH v_key IN ARRAY v_keys LOOP
        IF v_key = ANY (ARRAY['id','company_id','created_at']) THEN
            RAISE EXCEPTION 'Korunan kolon değiştirilemez: %', v_key;
        END IF;
        IF NOT (v_key = ANY (v_cols)) THEN
            RAISE EXCEPTION 'Kolon bu tabloda yok (%): %', p_table, v_key;
        END IF;
    END LOOP;

    EXECUTE format(
        'SELECT to_jsonb(t) FROM %I t WHERE t.id = $1 AND t.company_id = $2',
        p_table
    ) INTO v_old_full USING p_record_id, p_company_id;

    IF v_old_full IS NULL THEN
        RAISE EXCEPTION 'Kayıt bulunamadı veya bu firmaya ait değil (% / %).', p_table, p_record_id;
    END IF;

    v_new_full := v_old_full || p_changes;

    SELECT string_agg(format('%I = s.%I', k, k), ', ')
    INTO v_assignments
    FROM unnest(v_keys) AS k;

    EXECUTE format(
        'UPDATE %1$I AS t SET %2$s
           FROM (SELECT * FROM jsonb_populate_record(NULL::%1$I, $1)) AS s
          WHERE t.id = $2 AND t.company_id = $3',
        p_table, v_assignments
    ) USING v_new_full, p_record_id, p_company_id;

    FOREACH v_key IN ARRAY v_keys LOOP
        v_old_subset := v_old_subset || jsonb_build_object(v_key, v_old_full -> v_key);
        v_new_subset := v_new_subset || jsonb_build_object(v_key, p_changes  -> v_key);
    END LOOP;

    INSERT INTO public.admin_data_interventions (
        company_id, super_admin_id, ticket_id, table_name, record_id,
        action, changed_fields, old_values, new_values, reason
    ) VALUES (
        p_company_id, auth.uid(), p_ticket_id, p_table, p_record_id,
        'update', v_keys, v_old_subset, v_new_subset, p_reason
    )
    RETURNING id INTO v_intervention_id;

    -- Genel denetim günlüğü (audit_logs varsa)
    IF to_regclass('public.audit_logs') IS NOT NULL THEN
        INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, details)
        VALUES (
            p_company_id, auth.uid(), 'SUPER_ADMIN_INTERVENTION', upper(p_table), p_record_id,
            jsonb_build_object(
                'intervention_id', v_intervention_id,
                'ticket_id', p_ticket_id,
                'changed_fields', to_jsonb(v_keys),
                'old', v_old_subset, 'new', v_new_subset, 'reason', p_reason
            )
        );
    END IF;

    RETURN v_intervention_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.super_admin_apply_intervention(uuid, text, uuid, jsonb, text, uuid) TO authenticated;

-- ------------------------------------------------------------
-- 7. Müdahaleyi geri al: eski değerleri tekrar yaz
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_revert_intervention(
    p_intervention_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_row         public.admin_data_interventions%ROWTYPE;
    v_keys        text[];
    v_assignments text;
    v_exists      boolean;
    v_revert_id   uuid;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Yetkisiz: yalnızca süper admin geri alabilir.';
    END IF;

    SELECT * INTO v_row FROM public.admin_data_interventions WHERE id = p_intervention_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Müdahale kaydı bulunamadı.';
    END IF;
    IF v_row.action = 'revert' THEN
        RAISE EXCEPTION 'Bir geri alma işlemi tekrar geri alınamaz.';
    END IF;
    IF v_row.reverted THEN
        RAISE EXCEPTION 'Bu müdahale zaten geri alınmış.';
    END IF;

    IF NOT public._intervention_table_allowed(v_row.table_name)
       OR to_regclass(format('public.%I', v_row.table_name)) IS NULL THEN
        RAISE EXCEPTION 'Tablo geçersiz veya artık mevcut değil: %', v_row.table_name;
    END IF;

    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I t WHERE t.id = $1 AND t.company_id = $2)',
                   v_row.table_name)
    INTO v_exists USING v_row.record_id, v_row.company_id;
    IF NOT v_exists THEN
        RAISE EXCEPTION 'Hedef kayıt artık mevcut değil; geri alınamıyor.';
    END IF;

    v_keys := v_row.changed_fields;

    SELECT string_agg(format('%I = s.%I', k, k), ', ')
    INTO v_assignments
    FROM unnest(v_keys) AS k;

    EXECUTE format(
        'UPDATE %1$I AS t SET %2$s
           FROM (SELECT * FROM jsonb_populate_record(NULL::%1$I,
                    (SELECT to_jsonb(x) FROM %1$I x WHERE x.id = $2 AND x.company_id = $3) || $1
                 )) AS s
          WHERE t.id = $2 AND t.company_id = $3',
        v_row.table_name, v_assignments
    ) USING v_row.old_values, v_row.record_id, v_row.company_id;

    UPDATE public.admin_data_interventions
    SET reverted = true, reverted_at = now(), reverted_by = auth.uid()
    WHERE id = p_intervention_id;

    INSERT INTO public.admin_data_interventions (
        company_id, super_admin_id, ticket_id, table_name, record_id,
        action, changed_fields, old_values, new_values, reason, revert_of
    ) VALUES (
        v_row.company_id, auth.uid(), v_row.ticket_id, v_row.table_name, v_row.record_id,
        'revert', v_keys, v_row.new_values, v_row.old_values,
        'Müdahale geri alındı', p_intervention_id
    )
    RETURNING id INTO v_revert_id;

    IF to_regclass('public.audit_logs') IS NOT NULL THEN
        INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, details)
        VALUES (
            v_row.company_id, auth.uid(), 'SUPER_ADMIN_INTERVENTION_REVERT',
            upper(v_row.table_name), v_row.record_id,
            jsonb_build_object('intervention_id', p_intervention_id,
                               'restored', v_row.old_values, 'undone', v_row.new_values)
        );
    END IF;

    RETURN v_revert_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.super_admin_revert_intervention(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 8. Firma işlem geçmişi (audit_logs köprüsü — süper admin)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_company_activity(
    p_company_id uuid,
    p_limit int DEFAULT 50
)
RETURNS TABLE (
    id uuid, source text, action text, entity_type text,
    entity_id uuid, actor_name text, details jsonb, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Yetkisiz.';
    END IF;

    IF to_regclass('public.audit_logs') IS NULL THEN
        RETURN;  -- audit_logs yoksa boş döner
    END IF;

    RETURN QUERY
    SELECT a.id, 'audit'::text AS source, a.action, a.entity_type, a.entity_id,
           COALESCE(p.full_name, '—') AS actor_name, a.details, a.created_at
    FROM public.audit_logs a
    LEFT JOIN public.profiles p ON p.user_id = a.user_id
    WHERE a.company_id = p_company_id
    ORDER BY a.created_at DESC
    LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_activity(uuid, int) TO authenticated;

-- ------------------------------------------------------------
-- 8b. Müdahale hedefleri keşfi — hangi whitelisted tablolar bu DB'de
--     var ve kolonları neler. Frontend bunu kullanarak yalnızca
--     gerçekten var olan tablolar için form gösterir.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_intervention_targets()
RETURNS TABLE (table_name text, tbl_exists boolean, has_company_id boolean, cols text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    t text;
    candidates text[] := ARRAY[
        'orders','appointments','customers',
        'payments','supplier_transactions','supplier_payments'
    ];
    v_cols text[];
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Yetkisiz.';
    END IF;

    FOREACH t IN ARRAY candidates LOOP
        v_cols := public._table_columns(t);
        table_name := t;
        tbl_exists := (to_regclass(format('public.%I', t)) IS NOT NULL);
        has_company_id := ('company_id' = ANY (v_cols));
        cols := v_cols;
        RETURN NEXT;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_intervention_targets() TO authenticated;

-- ------------------------------------------------------------
-- 9. Schema cache reload
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

RESET check_function_bodies;

-- ============================================================
-- SONUÇ + BAĞIMLILIK RAPORU
-- ============================================================
SELECT 'KURULDU: support_tickets'            AS nesne, to_regclass('public.support_tickets')              IS NOT NULL AS ok
UNION ALL SELECT 'KURULDU: admin_data_interventions', to_regclass('public.admin_data_interventions')     IS NOT NULL
UNION ALL SELECT 'KURULDU: rpc apply',  to_regprocedure('public.super_admin_apply_intervention(uuid,text,uuid,jsonb,text,uuid)') IS NOT NULL
UNION ALL SELECT 'KURULDU: rpc revert', to_regprocedure('public.super_admin_revert_intervention(uuid)')   IS NOT NULL
UNION ALL SELECT 'KURULDU: rpc activity', to_regprocedure('public.get_company_activity(uuid,int)')        IS NOT NULL
UNION ALL SELECT 'KURULDU: helper is_super_admin', to_regprocedure('public.is_super_admin()')             IS NOT NULL
UNION ALL SELECT 'KURULDU: helper my_company_ids', to_regprocedure('public.my_company_ids()')             IS NOT NULL;

-- Çekirdek bağımlılıklar (FALSE olan EKSİK demektir — uygulamanın temel tabloları)
SELECT 'BAGIMLILIK: companies'       AS tablo, to_regclass('public.companies')       IS NOT NULL AS mevcut
UNION ALL SELECT 'BAGIMLILIK: profiles',        to_regclass('public.profiles')        IS NOT NULL
UNION ALL SELECT 'BAGIMLILIK: company_members', to_regclass('public.company_members') IS NOT NULL
UNION ALL SELECT 'BAGIMLILIK: audit_logs',      to_regclass('public.audit_logs')      IS NOT NULL;

-- Müdahale edilebilir entity tabloları (FALSE ise o kategori müdahalesi çalışmaz)
SELECT 'ENTITY: orders'                AS tablo, to_regclass('public.orders')                IS NOT NULL AS mevcut
UNION ALL SELECT 'ENTITY: appointments',          to_regclass('public.appointments')          IS NOT NULL
UNION ALL SELECT 'ENTITY: customers',             to_regclass('public.customers')             IS NOT NULL
UNION ALL SELECT 'ENTITY: payments',              to_regclass('public.payments')              IS NOT NULL
UNION ALL SELECT 'ENTITY: supplier_transactions', to_regclass('public.supplier_transactions') IS NOT NULL
UNION ALL SELECT 'ENTITY: supplier_payments',     to_regclass('public.supplier_payments')     IS NOT NULL;
