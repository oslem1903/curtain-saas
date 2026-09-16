-- Requires existing admin intervention system. Does not install base schema.
begin;
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
        'SELECT to_jsonb(t) FROM %I t WHERE t.id = $1 AND t.company_id = $2 FOR UPDATE',
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
    v_current jsonb;
    v_key text;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Yetkisiz: yalnızca süper admin geri alabilir.';
    END IF;

    SELECT * INTO v_row FROM public.admin_data_interventions WHERE id = p_intervention_id FOR UPDATE;
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

    EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE t.id = $1 AND t.company_id = $2 FOR UPDATE', v_row.table_name)
    INTO v_current USING v_row.record_id, v_row.company_id;
    IF v_current IS NULL THEN RAISE EXCEPTION 'Hedef kayıt artık mevcut değil.'; END IF;
    FOREACH v_key IN ARRAY v_row.changed_fields LOOP
        IF (v_current -> v_key) IS DISTINCT FROM (v_row.new_values -> v_key) THEN
            RAISE EXCEPTION 'Kayıt müdahaleden sonra değişmiş (%). Güncel veriyi kontrol edin; geri alma durduruldu.', v_key;
        END IF;
    END LOOP;

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


commit;
