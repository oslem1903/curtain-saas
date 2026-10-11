-- Salt okunur: 028 oncesinde mevcut deneme haklarini raporlar.
-- Bu migration yalnizca yeni kayit ayarini 14 gun yapar; raporlanan firma ve
-- trial_grants tarihlerini degistirmez. Gecmis denemeler kendiliginden yenilenmez.

SELECT id, enabled, trial_days, package_code, updated_at
FROM public.self_signup_settings
WHERE id = 1;

SELECT
  c.id AS company_id,
  c.name,
  c.package_code,
  c.plan_status,
  c.signup_source,
  coalesce(c.trial_started_at, c.trial_start) AS trial_started_at,
  c.trial_ends_at,
  coalesce(c.is_pilot, false) AS is_special_access,
  c.pilot_until,
  CASE
    WHEN coalesce(c.is_pilot, false) AND (c.pilot_until IS NULL OR c.pilot_until > now()) THEN 'special_access_overrides_trial'
    WHEN c.plan_status IN ('active', 'lifetime') THEN 'paid_or_lifetime'
    WHEN c.trial_ends_at IS NULL THEN 'missing_end_fail_closed'
    WHEN c.trial_ends_at <= now() THEN 'expired'
    ELSE 'active_trial'
  END AS effective_access
FROM public.companies c
WHERE lower(coalesce(c.plan_status, '')) IN ('trial', 'expired')
   OR c.trial_ends_at IS NOT NULL
ORDER BY c.trial_ends_at NULLS FIRST, c.created_at;

SELECT source, count(*) AS grants, min(trial_started_at) AS first_start,
       max(trial_started_at) AS latest_start,
       count(*) FILTER (WHERE trial_ends_at < now()) AS expired_grants
FROM public.trial_grants
GROUP BY source
ORDER BY source;