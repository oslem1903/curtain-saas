-- ============================================================================
-- MIGRATION 009: order_payment_plans + order_installments (taksitli/vadeli
-- musteri tahsilat sistemi - Faz 1 sema).
--
-- NOT: Bu dosya, production Supabase SQL Editor'da BASARIYLA calistirilmis ve
-- COMMIT olmus SQL'in birebir yerel kopyasidir (repoya sonradan eklendi).
-- Tekrar production'da calistirmayin.
--
-- Kapsam: yalnizca order_payment_plans / order_installments tablolari, tenant
-- consistency trigger'lari, RLS. customer_record_collection/
-- customer_cancel_collection'a ve orders.payment_due_date'e DOKUNULMADI.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.order_payment_plans (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id                uuid NOT NULL,
    order_id                  uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
    opening_total_amount      numeric(12,2) NOT NULL,
    opening_paid_amount       numeric(12,2) NOT NULL,
    opening_remaining_amount  numeric(12,2) NOT NULL,
    created_by                uuid,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_installments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id         uuid NOT NULL REFERENCES public.order_payment_plans(id) ON DELETE CASCADE,
    company_id      uuid NOT NULL,
    order_id        uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    installment_no  int NOT NULL,
    amount          numeric(12,2) NOT NULL CHECK (amount > 0),
    due_date        date NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plan_id, installment_no)
);

CREATE INDEX IF NOT EXISTS idx_order_payment_plans_order ON public.order_payment_plans(order_id);
CREATE INDEX IF NOT EXISTS idx_order_installments_plan ON public.order_installments(plan_id);
CREATE INDEX IF NOT EXISTS idx_order_installments_order ON public.order_installments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_installments_company_due ON public.order_installments(company_id, due_date);

CREATE OR REPLACE FUNCTION public.enforce_order_payment_plan_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_order_company uuid;
BEGIN
    SELECT company_id INTO v_order_company FROM public.orders WHERE id = NEW.order_id;
    IF v_order_company IS NULL THEN
        RAISE EXCEPTION 'tenant_integrity: order_id % bulunamadi', NEW.order_id;
    END IF;
    IF v_order_company <> NEW.company_id THEN
        RAISE EXCEPTION 'tenant_integrity: company_id (%) siparisin gercek company_id (%) ile uyusmuyor', NEW.company_id, v_order_company;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_payment_plans_tenant_check ON public.order_payment_plans;
CREATE TRIGGER trg_order_payment_plans_tenant_check
BEFORE INSERT OR UPDATE ON public.order_payment_plans
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_payment_plan_tenant_consistency();

CREATE OR REPLACE FUNCTION public.enforce_order_installment_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_order_company uuid;
    v_plan_order_id uuid;
    v_plan_company_id uuid;
BEGIN
    SELECT company_id INTO v_order_company FROM public.orders WHERE id = NEW.order_id;
    IF v_order_company IS NULL THEN
        RAISE EXCEPTION 'tenant_integrity: order_id % bulunamadi', NEW.order_id;
    END IF;
    IF v_order_company <> NEW.company_id THEN
        RAISE EXCEPTION 'tenant_integrity: company_id (%) siparisin gercek company_id (%) ile uyusmuyor', NEW.company_id, v_order_company;
    END IF;

    SELECT order_id, company_id INTO v_plan_order_id, v_plan_company_id
    FROM public.order_payment_plans WHERE id = NEW.plan_id;

    IF v_plan_order_id IS NULL THEN
        RAISE EXCEPTION 'tenant_integrity: plan_id % bulunamadi', NEW.plan_id;
    END IF;
    IF v_plan_order_id <> NEW.order_id OR v_plan_company_id <> NEW.company_id THEN
        RAISE EXCEPTION 'tenant_integrity: taksit satirinin order_id/company_id (%, %) degeri planin order_id/company_id (%, %) degeriyle uyusmuyor — yanlis plan/order kombinasyonu',
            NEW.order_id, NEW.company_id, v_plan_order_id, v_plan_company_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_installments_tenant_check ON public.order_installments;
CREATE TRIGGER trg_order_installments_tenant_check
BEFORE INSERT OR UPDATE ON public.order_installments
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_installment_tenant_consistency();

SELECT public.install_tenant_policy('order_payment_plans', true);
SELECT public.install_tenant_policy('order_installments', true);

NOTIFY pgrst, 'reload schema';

COMMIT;
