-- Migration 029a geri alma: yalnizca 029a'nin eklediği iki fonksiyonu kaldirir.
-- Baska hicbir nesne bunlara bagli degildir (tablo/politika/tetikleyici kullanmaz); istemci
-- (1.0.14) fonksiyon yoksa isTrialExpired() yedegine duser.
BEGIN;
DROP FUNCTION IF EXISTS public.company_subscription_access_snapshot(uuid);
DROP FUNCTION IF EXISTS public.company_subscription_access_allowed(uuid);
NOTIFY pgrst, 'reload schema';
COMMIT;
