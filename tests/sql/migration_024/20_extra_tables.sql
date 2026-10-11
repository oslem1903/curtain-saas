-- Yalnizca yeni korumanin etkisini olcmek icin: baska politikasi OLMAYAN is tablosu
create table if not exists public.payments (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id), amount numeric);
grant all on public.payments to authenticated;
