-- PerdePRO migration 014
-- Siparişten fatura oluştururken başlık + kalemleri tek transaction içinde kaydeder.
-- Ayrıca canlı testte eklenen geçici super-admin politikalarını kalıcı tenant
-- politikalarıyla birleştirir.

begin;

drop policy if exists "Users can insert own company invoices" on public.invoices;
drop policy if exists "invoices_demo_superadmin_insert" on public.invoices;
drop policy if exists "invoices_tenant_insert" on public.invoices;
create policy "invoices_tenant_insert"
on public.invoices
for insert
to authenticated
with check (
  public.is_super_admin()
  or (
    public.is_company_accounting(company_id)
    and public.is_company_writable(company_id)
  )
);

drop policy if exists "Users can insert own company invoice items" on public.invoice_items;
drop policy if exists "invoice_items_demo_superadmin_insert" on public.invoice_items;
drop policy if exists "invoice_items_tenant_insert" on public.invoice_items;
create policy "invoice_items_tenant_insert"
on public.invoice_items
for insert
to authenticated
with check (
  public.is_super_admin()
  or (
    public.is_company_accounting(company_id)
    and public.is_company_writable(company_id)
  )
);

create or replace function public.record_invoice_save(
    p_company_id uuid,
    p_invoice_id uuid,
    p_invoice_data jsonb,
    p_items_data jsonb[]
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_invoice_id uuid := coalesce(p_invoice_id, gen_random_uuid());
    v_item jsonb;
    v_count integer := 0;
begin
    if not public.is_company_accounting(p_company_id) then
        raise exception 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
    end if;

    if not public.is_super_admin() and not public.is_company_writable(p_company_id) then
        raise exception 'firma lisansi aktif degil veya sadece okuma modunda';
    end if;

    if not public.check_rate_limit('record_invoice_save', 1, 3) then
        return json_build_object(
            'success', false,
            'error', 'Çok hızlı tekrar denendi. Lütfen 3 saniye bekleyin.',
            'invoice_id', null
        );
    end if;

    insert into public.invoices (
        id, company_id, invoice_no, invoice_type, date,
        total_tax_exclusive, total_tax_amount, total_tax_inclusive,
        paid_amount, payment_method, due_date, status,
        order_id, customer_id, supplier_id, notes, created_at, updated_at
    ) values (
        v_invoice_id,
        p_company_id,
        p_invoice_data->>'invoice_no',
        p_invoice_data->>'invoice_type',
        coalesce((p_invoice_data->>'date')::timestamptz, now()),
        coalesce((p_invoice_data->>'total_tax_exclusive')::numeric, 0),
        coalesce((p_invoice_data->>'total_tax_amount')::numeric, 0),
        coalesce((p_invoice_data->>'total_tax_inclusive')::numeric, 0),
        coalesce((p_invoice_data->>'paid_amount')::numeric, 0),
        nullif(p_invoice_data->>'payment_method', ''),
        nullif(p_invoice_data->>'due_date', '')::timestamptz,
        coalesce(nullif(p_invoice_data->>'status', ''), 'draft'),
        nullif(p_invoice_data->>'order_id', '')::uuid,
        nullif(p_invoice_data->>'customer_id', '')::uuid,
        nullif(p_invoice_data->>'supplier_id', '')::uuid,
        nullif(p_invoice_data->>'notes', ''),
        now(),
        now()
    )
    on conflict (id) do update set
        invoice_no = excluded.invoice_no,
        invoice_type = excluded.invoice_type,
        date = excluded.date,
        total_tax_exclusive = excluded.total_tax_exclusive,
        total_tax_amount = excluded.total_tax_amount,
        total_tax_inclusive = excluded.total_tax_inclusive,
        paid_amount = excluded.paid_amount,
        payment_method = excluded.payment_method,
        due_date = excluded.due_date,
        status = excluded.status,
        order_id = excluded.order_id,
        customer_id = excluded.customer_id,
        supplier_id = excluded.supplier_id,
        notes = excluded.notes,
        updated_at = now()
    where public.invoices.company_id = p_company_id
    returning id into v_invoice_id;

    if v_invoice_id is null then
        raise exception 'Fatura bulunamadi veya baska firmaya ait.';
    end if;

    delete from public.invoice_items
    where invoice_id = v_invoice_id
      and company_id = p_company_id;

    foreach v_item in array coalesce(p_items_data, array[]::jsonb[]) loop
        insert into public.invoice_items (
            invoice_id, company_id, description, quantity,
            unit_price, tax_rate, line_total
        ) values (
            v_invoice_id,
            p_company_id,
            coalesce(nullif(v_item->>'description', ''), 'Ürün/Hizmet'),
            coalesce((v_item->>'quantity')::numeric, 1),
            coalesce((v_item->>'unit_price')::numeric, 0),
            coalesce((v_item->>'tax_rate')::numeric, 20),
            coalesce((v_item->>'line_total')::numeric, 0)
        );
        v_count := v_count + 1;
    end loop;

    return json_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'items_saved', v_count
    );
exception when others then
    return json_build_object(
        'success', false,
        'error', sqlerrm,
        'error_code', sqlstate,
        'invoice_id', null
    );
end;
$$;

revoke all on function public.record_invoice_save(uuid, uuid, jsonb, jsonb[]) from public;
grant execute on function public.record_invoice_save(uuid, uuid, jsonb, jsonb[]) to authenticated;

comment on function public.record_invoice_save(uuid, uuid, jsonb, jsonb[]) is
'Tenant kontrollü, atomik fatura başlık ve kalem kaydı. Migration 014.';

-- Yeni sipariş kaydı sırasında tahsilat başarısız olursa, henüz ödeme almamış
-- otomatik faturayı güvenli biçimde geri alır. Mevcut/ödenmiş faturaları silemez.
create or replace function public.rollback_new_order_invoice(
    p_company_id uuid,
    p_order_id uuid,
    p_invoice_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_deleted integer := 0;
begin
    if not public.is_company_accounting(p_company_id) then
        raise exception 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
    end if;

    if not public.is_super_admin() and not public.is_company_writable(p_company_id) then
        raise exception 'firma lisansi aktif degil veya sadece okuma modunda';
    end if;

    delete from public.invoices
    where id = p_invoice_id
      and company_id = p_company_id
      and order_id = p_order_id
      and coalesce(paid_amount, 0) = 0
      and status in ('draft', 'sent');

    get diagnostics v_deleted = row_count;
    if v_deleted <> 1 then
        raise exception 'Geri alinabilir yeni siparis faturasi bulunamadi.';
    end if;

    return json_build_object('success', true, 'deleted', v_deleted);
exception when others then
    return json_build_object('success', false, 'error', sqlerrm, 'error_code', sqlstate);
end;
$$;

revoke all on function public.rollback_new_order_invoice(uuid, uuid, uuid) from public;
grant execute on function public.rollback_new_order_invoice(uuid, uuid, uuid) to authenticated;

comment on function public.rollback_new_order_invoice(uuid, uuid, uuid) is
'Yeni siparis tahsilati basarisiz oldugunda yalnizca odemesiz otomatik faturayi geri alir. Migration 014.';

commit;
