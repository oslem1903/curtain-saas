-- =============================================================================
-- Migration 035: billing_apply_charge — reddedilen/test olaylari olay anahtarini tuketmez
--
-- Sorun: tutar uyusmazligi, test modu vb. nedenlerle uygulanmayan bir bildirim
-- (channel, provider_event_id) anahtarini kalici olarak "duplicate" yapiyordu; ayni siparis icin
-- sonradan gelen GECERLI basarili bildirim islenemezdi. Cozum: uygulanmayan olaylarin anahtari
-- denetim icin yeniden adlandirilir. Basarili uygulanan ve yinelenen (duplicate_payment) olaylar
-- degismez: ayni odeme ikinci kez sure UZATMAZ.
-- ONKOSUL: 033, 034.   GERI ALMA: 033'teki billing_apply_charge govdesi.
-- =============================================================================
BEGIN;
CREATE OR REPLACE FUNCTION public.billing_apply_charge(
  p_channel text, p_event_id text, p_company_id uuid, p_plan_code text,
  p_provider_payment_id text, p_amount_minor integer, p_currency text,
  p_provider_subscription_ref text DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb,
  p_test_mode boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_plan public.billing_plans%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_event_id uuid;
  v_base timestamptz;
  v_end timestamptz;
  v_sub_id uuid;
  v_inserted int;
  v_pay_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;

  INSERT INTO public.billing_events(channel, provider_event_id, event_type, company_id, payload)
  VALUES (p_channel, p_event_id, 'charge.succeeded', p_company_id, coalesce(p_payload,'{}'::jsonb))
  ON CONFLICT (channel, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN RETURN jsonb_build_object('status','duplicate'); END IF;

  SELECT * INTO v_plan FROM public.billing_plans WHERE code = p_plan_code AND is_active;
  IF NOT FOUND THEN
    UPDATE public.billing_events SET outcome='rejected_unknown_plan', processed_at=now(),
      provider_event_id = provider_event_id || ':rejected_unknown_plan:' || id::text WHERE id=v_event_id;
    RETURN jsonb_build_object('status','rejected','reason','unknown_plan');
  END IF;
  IF p_amount_minor IS DISTINCT FROM v_plan.price_minor OR upper(p_currency) IS DISTINCT FROM v_plan.currency THEN
    UPDATE public.billing_events SET outcome='rejected_amount_mismatch', processed_at=now(),
      provider_event_id = provider_event_id || ':rejected_amount_mismatch:' || id::text WHERE id=v_event_id;
    RETURN jsonb_build_object('status','rejected','reason','amount_mismatch');
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.billing_events SET outcome='rejected_unknown_company', processed_at=now(),
      provider_event_id = provider_event_id || ':rejected_unknown_company:' || id::text WHERE id=v_event_id;
    RETURN jsonb_build_object('status','rejected','reason','unknown_company');
  END IF;
  IF lower(coalesce(v_company.plan_status,'')) = 'suspended' THEN
    UPDATE public.billing_events SET outcome='blocked_suspended', processed_at=now(),
      provider_event_id = provider_event_id || ':blocked_suspended:' || id::text WHERE id=v_event_id;
    RETURN jsonb_build_object('status','blocked','reason','company_suspended');
  END IF;

  -- TEST modu odemesi: gercek firmanin lisansini ACMAZ.
  IF coalesce(p_test_mode, false)
     AND NOT EXISTS (SELECT 1 FROM public.billing_test_companies t WHERE t.company_id = p_company_id) THEN
    UPDATE public.billing_events SET outcome='test_payment_no_license', processed_at=now(),
      provider_event_id = provider_event_id || ':test_payment_no_license:' || id::text WHERE id=v_event_id;
    RETURN jsonb_build_object('status','test_no_license');
  END IF;

  -- Ayni odeme ikinci kez gelirse HICBIR sey degismez: once odeme kaydi.
  INSERT INTO public.billing_payments(company_id, channel, provider_payment_id, kind, status, amount_minor, currency)
  VALUES (p_company_id, p_channel, p_provider_payment_id, 'charge', 'succeeded', p_amount_minor, v_plan.currency)
  ON CONFLICT (channel, provider_payment_id, kind) DO NOTHING
  RETURNING id INTO v_pay_id;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    UPDATE public.billing_events SET outcome='duplicate_payment', processed_at=now() WHERE id=v_event_id;
    RETURN jsonb_build_object('status','duplicate');
  END IF;

  -- Erisim, kalan odenmis donem/deneme sonundan uzar; gecmisse simdiden baslar.
  v_base := greatest(now(), coalesce(
    CASE WHEN lower(coalesce(v_company.plan_status,'')) = 'active' THEN v_company.license_expires_at
         WHEN lower(coalesce(v_company.plan_status,'')) IN ('trial','') THEN v_company.trial_ends_at
    END, now()));
  v_end := ((v_base AT TIME ZONE 'Europe/Istanbul')
            + CASE v_plan.period WHEN 'year' THEN interval '1 year' ELSE interval '1 month' END)
           AT TIME ZONE 'Europe/Istanbul';

  SELECT id INTO v_sub_id FROM public.billing_subscriptions
   WHERE company_id = p_company_id AND status IN ('pending','active','past_due') FOR UPDATE;
  IF v_sub_id IS NULL THEN
    INSERT INTO public.billing_subscriptions(company_id, plan_code, channel, provider_subscription_ref, status, current_period_start, current_period_end)
    VALUES (p_company_id, p_plan_code, p_channel, p_provider_subscription_ref, 'active', v_base, v_end)
    RETURNING id INTO v_sub_id;
  ELSE
    UPDATE public.billing_subscriptions SET plan_code=p_plan_code, channel=p_channel,
      provider_subscription_ref=coalesce(p_provider_subscription_ref, provider_subscription_ref),
      status='active', current_period_end=v_end, updated_at=now() WHERE id=v_sub_id;
  END IF;

  UPDATE public.billing_payments SET subscription_id = v_sub_id, period_start = v_base, period_end = v_end WHERE id = v_pay_id;

  UPDATE public.companies SET plan_status='active', subscription_status='active', license_expires_at=v_end,
         package_code=v_plan.package_code,
         subscription_plan = CASE WHEN lower(v_plan.package_code) = 'solo' THEN 'solo' ELSE subscription_plan END,
         is_active = true, updated_at=now()
   WHERE id = p_company_id;

  UPDATE public.billing_events SET outcome='applied', processed_at=now() WHERE id=v_event_id;
  RETURN jsonb_build_object('status','applied','period_end',v_end,'subscription_id',v_sub_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.billing_apply_charge(text,text,uuid,text,text,integer,text,text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_charge(text,text,uuid,text,text,integer,text,text,jsonb,boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
