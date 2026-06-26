-- Curtain SaaS: Accounting / invoice ERP upgrade

alter table public.invoices
    add column if not exists due_date date,
    add column if not exists paid_amount numeric(15,2) default 0,
    add column if not exists remaining_amount numeric(15,2) default 0,
    add column if not exists payment_method text,
    add column if not exists cancelled_at timestamptz;

create index if not exists invoices_company_date_idx
    on public.invoices(company_id, date desc);

create index if not exists invoices_company_status_idx
    on public.invoices(company_id, status);

create index if not exists invoices_company_due_date_idx
    on public.invoices(company_id, due_date);

-- Supported app statuses:
-- draft, sent, issued, partial, paid, overdue, cancelled
