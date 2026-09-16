-- PerdePRO son surum kontrolu (SALT OKUNUR)
-- Supabase SQL Editor'da oldugu gibi calistirilabilir.

with
known_order as (
  select 'd61b3bed-6550-4149-8f6d-5a65bad49226'::uuid as id
),
function_state as (
  select
    p.proname,
    pg_get_functiondef(p.oid) as definition,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'record_invoice_save',
      'rollback_new_order_invoice',
      'check_subscription_active',
      'is_company_writable'
    )
),
checks as (
  select
    '014 / atomik fatura RPC'::text as kontrol,
    case when exists (
      select 1 from function_state
      where proname = 'record_invoice_save'
        and definition ilike '%invoice_id, company_id, description%'
        and definition ilike '%public.is_company_accounting%'
    ) then 'PASS' else 'MIGRATION_014_GEREKLI' end as durum,
    'Fatura basligi ve kalemleri tek transaction icinde kaydedilmeli.'::text as detay

  union all
  select
    '014 / guvenli geri alma RPC',
    case when to_regprocedure('public.rollback_new_order_invoice(uuid,uuid,uuid)') is not null
      then 'PASS' else 'MIGRATION_014_GEREKLI' end,
    'Pesinat basarisizliginda odemesiz otomatik faturayi geri alir.'

  union all
  select
    '014 / invoice INSERT politikalari',
    case when (
      select count(*) from pg_policies
      where schemaname = 'public'
        and policyname in ('invoices_tenant_insert', 'invoice_items_tenant_insert')
    ) = 2 then 'PASS' else 'MIGRATION_014_GEREKLI' end,
    'Gecici demo politikalari yerine kalici tenant politikalari.'

  union all
  select
    '012 / finansal RPC firma izolasyonu',
    case when not exists (
      select 1
      from unnest(array[
        'record_order_payment','record_invoice_save','record_income_entry',
        'record_expense_entry','record_installer_payment',
        'cancel_installer_payment','record_supplier_payment'
      ]) as f(name)
      where not exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = f.name
          and pg_get_functiondef(p.oid) ilike '%unauthorized: bu firmaya erisim yok%'
      )
    ) then 'PASS' else 'MIGRATION_012_INCELENMELI' end,
    'Yedi finansal RPC baska firma kimligiyle yazmayi reddetmeli.'

  union all
  select
    '013 / lisans fonksiyonu',
    case when exists (
      select 1 from function_state
      where proname = 'check_subscription_active'
        and definition ilike '%plan_status%'
        and definition not ilike '%subscription_plan%'
    ) then 'PASS' else 'MIGRATION_013_IS_KARARI_GEREKLI' end,
    '013 uygulanmadan once etkilenebilecek firma sayisi asagida raporlanir.'

  union all
  select
    '013 / bugun etkilenebilecek firma',
    case when count(*) = 0 then 'PASS' else 'DIKKAT_' || count(*)::text || '_FIRMA' end,
    'Trial suresi dolmus/eksik pilot olmayan aktif firma sayisi.'
  from public.companies
  where coalesce(is_active, true) = true
    and coalesce(is_pilot, false) = false
    and coalesce(plan_status, 'trial') not in ('active', 'lifetime', 'suspended', 'expired')
    and (trial_ends_at is null or trial_ends_at < now())

  union all
  select
    'Canli kanit siparisi',
    case when count(*) = 1 then 'PASS' else 'BULUNAMADI' end,
    'd61b3bed... siparis kaydi.'
  from public.orders o join known_order k on k.id = o.id

  union all
  select
    'Canli kanit urun satiri',
    case when count(*) > 0 then 'PASS' else 'EKSIK' end,
    count(*)::text || ' order_items satiri.'
  from public.order_items oi join known_order k on k.id = oi.order_id

  union all
  select
    'Canli kanit faturasi',
    case when count(*) > 0 then 'PASS' else 'EKSIK' end,
    count(*)::text || ' fatura.'
  from public.invoices i join known_order k on k.id = i.order_id

  union all
  select
    'Canli kanit montaj isi',
    case when count(*) > 0 then 'PASS' else 'EKSIK' end,
    count(*)::text || ' installation_jobs kaydi.'
  from public.installation_jobs j join known_order k on k.id = j.order_id
)
select kontrol, durum, detay
from checks
order by kontrol;

