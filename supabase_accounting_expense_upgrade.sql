-- Professional accounting expense fields and reminder support.
-- Run in Supabase SQL Editor.

alter table public.expenses add column if not exists due_date timestamptz;
alter table public.expenses add column if not exists document_no text;
alter table public.expenses add column if not exists is_installment boolean not null default false;
alter table public.expenses add column if not exists installment_count integer;
alter table public.expenses add column if not exists is_recurring boolean not null default false;

create index if not exists idx_expenses_company_due_status
    on public.expenses(company_id, due_date, status);

create index if not exists idx_expenses_company_category
    on public.expenses(company_id, category);
