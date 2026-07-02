-- Order line items + supplier cari infrastructure
-- Run in Supabase SQL editor after existing migrations.

-- Per-line supplier debt ledger (used by SupplierDetail, NewOrder)
CREATE TABLE IF NOT EXISTS public.supplier_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
    order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
    transaction_date timestamptz NOT NULL DEFAULT now(),
    transaction_type text NOT NULL CHECK (transaction_type IN ('debt', 'payment', 'cancel')),
    amount numeric NOT NULL DEFAULT 0,
    description text,
    reference_no text,
    payment_method text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_transactions_company ON public.supplier_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier ON public.supplier_transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_transactions_order ON public.supplier_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_transactions_order_item ON public.supplier_transactions(order_item_id);

-- Link order_items to supplier cari rows when posted
SELECT public.add_column_if_table_exists('order_items', 'supplier_transaction_id', 'uuid REFERENCES public.supplier_transactions(id) ON DELETE SET NULL');

-- Ensure line-level cost/profit columns exist (idempotent)
SELECT public.add_column_if_table_exists('order_items', 'supplier_id', 'uuid REFERENCES public.suppliers(id) ON DELETE SET NULL');
SELECT public.add_column_if_table_exists('order_items', 'supplier_unit_cost', 'numeric DEFAULT 0');
SELECT public.add_column_if_table_exists('order_items', 'supplier_total_cost', 'numeric DEFAULT 0');
SELECT public.add_column_if_table_exists('order_items', 'profit', 'numeric DEFAULT 0');
SELECT public.add_column_if_table_exists('order_items', 'area_m2', 'numeric');

SELECT public.install_tenant_policy('supplier_transactions', false);
