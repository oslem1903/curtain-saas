-- ============================================================
-- PERDEPRO - installer_earnings_insert RLS policy fix (B2)
--
-- BULGU (canli DB'den pg_policies ile dogrulandi, ffhmzlcsgsgjonqqhgqq):
--   installer_earnings_insert policy'sinin WITH CHECK ifadesi:
--     (EXISTS (...rol admin/super_admin kontrolu...)) OR TRUE
--   Sondaki "OR TRUE" tum kontrolu anlamsizlastiriyor - admin/super_admin
--   olmayan HERHANGI BIR authenticated kullanici, istedigi company_id/
--   installer_id ile installer_earnings'e satir ekleyebiliyor (cross-tenant
--   sahte veri enjeksiyonu).
--
-- KOKEN (supabase_installer_commission_schema.sql:108-114'teki orijinal
-- yorum): "OR TRUE" bilincli eklenmisti cunku montaj isi tamamlandiginda
-- otomatik 'earning' satiri ekleyen bir trigger (on_installation_job_completed)
-- vardi ve bu trigger'in insert'i normal kullanici rolüyle calisiyordu.
--
-- O trigger DAHA SONRA baska bir migration'da (supabase_installer_commission_
-- triggers.sql) BILINCLI olarak kaldirildi - gerekce: installation_jobs.
-- installer_fee (uygulamada hesaplanan) ile CIFT SAYIM yapiyordu. installer_
-- earnings artik tek dogruluk kaynagi degil; ne installer_record_payment RPC'si
-- ne get_installer_cari_summary/get_installer_ledger RPC'leri ne de herhangi
-- bir frontend dosyasi bu tabloya yaziyor/okuyor (grep: 0 sonuc). Canli DB'de
-- installation_jobs/installer_payments uzerinde artik hicbir trigger yok ve
-- installer_earnings 0 satir iceriyor.
--
-- SONUC: "OR TRUE" bypass'inin gerekcesi (trigger) ortadan kalkti ama policy
-- guncellenmedi - bugun itibariyla kullanilmayan ama acik duran bir RLS
-- deligi. Bu migration yalnizca bu bypass'i kaldirir; admin/super_admin
-- kontrolu AYNEN korunur. installer_transactions, installer_payments,
-- installation_jobs, RPC fonksiyonlari ve frontend'e DOKUNULMAZ.
-- ============================================================

DROP POLICY IF EXISTS installer_earnings_insert ON public.installer_earnings;

CREATE POLICY installer_earnings_insert ON public.installer_earnings
FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin'))
);

-- SONUC / dogrulama: INSERT policy var mi + WITH CHECK icinde artik "OR TRUE"
-- (ya da esdegeri "true") kalmadigini goster.
SELECT
    pol.polname AS policy_name,
    pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr,
    (pol.polname IS NOT NULL) AS insert_policy_exists,
    NOT (pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%OR TRUE%'
         OR pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%OR true%') AS or_true_removed
FROM pg_policy pol
JOIN pg_class rel ON rel.oid = pol.polrelid
WHERE rel.relname = 'installer_earnings'
  AND pol.polname = 'installer_earnings_insert';
