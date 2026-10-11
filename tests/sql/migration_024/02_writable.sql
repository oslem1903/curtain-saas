CREATE OR REPLACE FUNCTION public.is_company_writable(p_company_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    is_super_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.company_members
        WHERE user_id = auth.uid()
          AND company_id = p_company_id
          AND role IN ('admin', 'owner')
      )
      AND EXISTS (
        SELECT 1
        FROM public.companies c
        WHERE c.id = p_company_id
          AND COALESCE(c.is_active, true) = true
          AND COALESCE(c.read_only, false) = false
          AND COALESCE(c.plan_status, 'trial') NOT IN ('suspended', 'expired')
          AND (
            COALESCE(c.is_pilot, false) = true
            OR COALESCE(c.plan_status, 'trial') = 'lifetime'
            OR (
              COALESCE(c.plan_status, 'trial') = 'active'
              AND (c.license_expires_at IS NULL OR c.license_expires_at >= now())
            )
            OR (
              COALESCE(c.plan_status, 'trial') = 'trial'
              AND c.trial_ends_at IS NOT NULL
              AND c.trial_ends_at >= now()
            )
          )
      )
    )
  );
END;
$function$;
