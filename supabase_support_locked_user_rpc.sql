-- ============================================================
-- PERDEPRO - Locked Kullanıcılar İçin Destek Talebi RPC
--
-- Amaç:
-- Aktif olmayan şirkete sahip locked kullanıcılar destek
-- talebi açabilsin, ama RLS bypass ettirmeden ve başka
-- şirkete adına ticket açamazlar.
--
-- Mekanizma:
-- SECURITY DEFINER RPC — user_id parametresi yok,
-- auth.uid() kullanılır. Kullanıcı sadece kendisi adına
-- ticket açabilir. company_members'da kaydı varsa (is_active
-- şartı olmadan) ticket açabilir.
--
-- Güvenlik:
-- - auth.uid() NULL ise hata
-- - p_company_id NULL ise hata
-- - Kullanıcının p_company_id için company_members kaydı gerekli
-- - company kaydı doğrulanır
-- - category/priority enum kontroller
-- - title/description boş olamaz
-- - Hata detayları sızdırılmaz
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_support_ticket_as_locked_user(
    p_company_id UUID,
    p_title TEXT,
    p_description TEXT,
    p_category TEXT DEFAULT 'request',
    p_priority TEXT DEFAULT 'medium',
    p_page_url TEXT DEFAULT NULL,
    p_support_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
    v_user_id UUID;
    v_ticket_id UUID;
    v_company_exists BOOLEAN;
    v_user_member BOOLEAN;
BEGIN
    -- 1. Auth kontrol
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'authentication_required');
    END IF;

    -- 2. Parametreleri doğrula
    IF p_company_id IS NULL THEN
        RETURN jsonb_build_object('error', 'company_id_required');
    END IF;

    IF COALESCE(p_title, '') = '' THEN
        RETURN jsonb_build_object('error', 'title_required');
    END IF;

    IF COALESCE(p_description, '') = '' THEN
        RETURN jsonb_build_object('error', 'description_required');
    END IF;

    -- 3. Category ve priority kontrol (enum değerleri)
    IF p_category NOT IN ('bug', 'question', 'request', 'payment', 'other') THEN
        RETURN jsonb_build_object('error', 'invalid_category');
    END IF;

    IF p_priority NOT IN ('low', 'medium', 'high', 'urgent') THEN
        RETURN jsonb_build_object('error', 'invalid_priority');
    END IF;

    -- 4. Şirketin var olup olmadığını kontrol et
    v_company_exists := EXISTS(
        SELECT 1 FROM public.companies WHERE id = p_company_id
    );
    IF NOT v_company_exists THEN
        RETURN jsonb_build_object('error', 'company_not_found');
    END IF;

    -- 5. Kullanıcının bu şirketin üyesi olup olmadığını kontrol et
    -- NOT: is_active şartı ARAMA — locked kullanıcı da destek alabilmeli
    v_user_member := EXISTS(
        SELECT 1 FROM public.company_members
        WHERE user_id = v_user_id AND company_id = p_company_id
    );
    IF NOT v_user_member THEN
        RETURN jsonb_build_object('error', 'company_membership_required');
    END IF;

    -- 6. Support metadata boyutu kontrol (10 KB max)
    IF octet_length(p_support_metadata::text) > 10240 THEN
        RETURN jsonb_build_object('error', 'metadata_too_large');
    END IF;

    -- 7. Ticket insert et
    BEGIN
        INSERT INTO public.support_tickets(
            company_id,
            user_id,
            title,
            description,
            category,
            priority,
            page_url,
            support_metadata,
            status
        )
        VALUES(
            p_company_id,
            v_user_id,
            p_title,
            p_description,
            p_category,
            p_priority,
            p_page_url,
            COALESCE(p_support_metadata, '{}'::jsonb),
            'open'
        )
        RETURNING id INTO v_ticket_id;

        RETURN jsonb_build_object(
            'success', true,
            'ticket_id', v_ticket_id
        );

    EXCEPTION WHEN OTHERS THEN
        -- Hata detaylarını sızdırma — generic mesaj döndür
        RETURN jsonb_build_object('error', 'ticket_creation_failed');
    END;

END;
$body$;

-- Grant EXECUTE permission sadece authenticated role'e
GRANT EXECUTE ON FUNCTION public.create_support_ticket_as_locked_user(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO authenticated;
