create or replace function public.enforce_tenant_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    raise exception 'company_id zorunludur.';
  end if;

  if not public.is_super_admin() and not public.is_company_member(new.company_id) then
    raise exception 'Bu firmaya işlem yapma yetkiniz yok.';
  end if;

  if public.is_super_admin() then
    return new;
  end if;

  if not public.is_company_writable(new.company_id) then
    raise exception 'Firma lisansı aktif değil veya sadece okuma modunda.';
  end if;

  return new;
end;
$$;
create or replace function public.install_tenant_policy(p_table text, p_accounting_only boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.' || p_table) is null then
    return;
  end if;

  execute format('alter table public.%I enable row level security', p_table);

  execute format('drop policy if exists %I on public.%I', p_table || '_tenant_select', p_table);
  execute format(
    'create policy %I on public.%I for select to authenticated using (public.is_super_admin() or public.is_company_member(company_id))',
    p_table || '_tenant_select',
    p_table
  );

  execute format('drop policy if exists %I on public.%I', p_table || '_tenant_insert', p_table);
  execute format(
    'create policy %I on public.%I for insert to authenticated with check (public.is_super_admin() or (%s and public.is_company_writable(company_id)))',
    p_table || '_tenant_insert',
    p_table,
    case when p_accounting_only then 'public.is_company_accounting(company_id)' else 'public.is_company_member(company_id)' end
  );

  execute format('drop policy if exists %I on public.%I', p_table || '_tenant_update', p_table);
  execute format(
    'create policy %I on public.%I for update to authenticated using (public.is_super_admin() or (%s and public.is_company_writable(company_id))) with check (public.is_super_admin() or (%s and public.is_company_writable(company_id)))',
    p_table || '_tenant_update',
    p_table,
    case when p_accounting_only then 'public.is_company_accounting(company_id)' else 'public.is_company_member(company_id)' end,
    case when p_accounting_only then 'public.is_company_accounting(company_id)' else 'public.is_company_member(company_id)' end
  );

  execute format('drop policy if exists %I on public.%I', p_table || '_tenant_delete', p_table);
  execute format(
    'create policy %I on public.%I for delete to authenticated using (public.is_super_admin() or (%s and public.is_company_writable(company_id)))',
    p_table || '_tenant_delete',
    p_table,
    case when p_accounting_only then 'public.is_company_accounting(company_id)' else 'public.is_company_admin(company_id)' end
  );

  execute format('drop trigger if exists trg_%I_tenant_write on public.%I', p_table, p_table);
  execute format(
    'create trigger trg_%I_tenant_write before insert or update on public.%I for each row execute function public.enforce_tenant_write()',
    p_table,
    p_table
  );
end;
$$;
select public.install_tenant_policy('customers', false);
select public.install_tenant_policy('orders', false);
select public.install_tenant_policy('support_tickets', false);
alter table public.companies enable row level security;
create policy companies_member_select on public.companies for select to authenticated using (public.is_super_admin() or public.is_company_member(id));
alter table public.company_members enable row level security;
create policy cm_self_select on public.company_members for select to authenticated using (user_id = auth.uid() or public.is_super_admin() or public.is_company_member(company_id));
alter table public.profiles enable row level security;
create policy profiles_self on public.profiles for select to authenticated using (user_id = auth.uid() or public.is_super_admin());
