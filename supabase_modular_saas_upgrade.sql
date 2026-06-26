-- =========================================================
-- MODULAR SAAS / ROOM BASED ORDERING UPGRADE
-- Additive migration. Does not delete existing tables or data.
-- =========================================================

-- 1. Company licensing
ALTER TABLE companies ADD COLUMN IF NOT EXISTS enabled_modules text[];
ALTER TABLE companies ADD COLUMN IF NOT EXISTS package_code text DEFAULT 'starter';

ALTER TABLE companies DISABLE TRIGGER USER;

UPDATE companies
SET enabled_modules = CASE
    WHEN subscription_plan IN ('enterprise', 'lifetime') THEN ARRAY['admin','measurements','orders','suppliers','installation','accounting','staff','vehicles','commissions','warehouse','catalogs','reports','expenses','profit','branches','customers','appointments']
    WHEN subscription_plan = 'pro' THEN ARRAY['admin','measurements','orders','suppliers','installation','accounting','staff','catalogs','reports','expenses','profit','customers','appointments']
    ELSE ARRAY['admin','measurements','orders','customers','appointments']
END
WHERE enabled_modules IS NULL;

UPDATE companies
SET package_code = 'solo'
WHERE package_code IS NULL AND subscription_plan = 'starter';

ALTER TABLE companies ENABLE TRIGGER USER;

-- 2. Customer rooms and room based items
CREATE TABLE IF NOT EXISTS customer_rooms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
    name text NOT NULL,
    note text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES customer_rooms(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS room text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_options jsonb DEFAULT '{}'::jsonb;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fabric_width_cm numeric;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sewing_allowance_cm numeric DEFAULT 15;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS calculation_note text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS supplier_unit_cost numeric DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS supplier_total_cost numeric DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS profit numeric DEFAULT 0;

-- 3. Product options and Picasso
ALTER TABLE products ADD COLUMN IF NOT EXISTS option_pricing jsonb DEFAULT '{}'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_replacement_for text;

ALTER TABLE products DISABLE TRIGGER USER;

UPDATE products
SET name = COALESCE(NULLIF(name, ''), 'Picasso'),
    category = 'picasso',
    is_replacement_for = 'cam_balkon'
WHERE lower(coalesce(category, '')) IN ('cam_balkon', 'cam balkon');

INSERT INTO products (company_id, name, category, unit_price, is_active, option_pricing)
SELECT c.id, 'Picasso', 'picasso', 0, true, '{"calculation": "jalousie"}'::jsonb
FROM companies c
WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.company_id = c.id AND lower(coalesce(p.category, '')) = 'picasso'
);

ALTER TABLE products ENABLE TRIGGER USER;

-- 4. Catalog code photos, multiple per product/order item
CREATE TABLE IF NOT EXISTS catalog_code_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
    customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id uuid REFERENCES order_items(id) ON DELETE CASCADE,
    appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
    catalog_code text,
    image_url text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamptz DEFAULT now()
);

-- 5. Deposit / prepayment
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_amount numeric DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_total_cost numeric DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gross_profit numeric DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS installer_id uuid;

ALTER TABLE orders DISABLE TRIGGER USER;

UPDATE orders
SET deposit_amount = COALESCE(deposit_amount, paid_amount, 0),
    remaining_amount = GREATEST(COALESCE(total_amount, 0) - COALESCE(deposit_amount, paid_amount, 0), 0)
WHERE deposit_amount IS NULL OR remaining_amount IS NULL;

ALTER TABLE orders ENABLE TRIGGER USER;

-- 6. Supplier product and historical price lists
CREATE TABLE IF NOT EXISTS supplier_product_prices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
    supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE,
    product_type text NOT NULL,
    unit_price numeric NOT NULL DEFAULT 0,
    currency text DEFAULT 'TRY',
    valid_from date NOT NULL DEFAULT CURRENT_DATE,
    valid_to date,
    note text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_product_prices_lookup_idx
ON supplier_product_prices(company_id, supplier_id, product_type, valid_from DESC);

-- 7. Supplier current account helpers
CREATE TABLE IF NOT EXISTS supplier_work_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
    supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
    total_cost numeric DEFAULT 0,
    status text DEFAULT 'open',
    note text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
    supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE,
    payment_date timestamptz DEFAULT now(),
    amount numeric NOT NULL DEFAULT 0,
    payment_method text,
    note text,
    created_at timestamptz DEFAULT now()
);

-- 8. Installer balances and installation errors
CREATE TABLE IF NOT EXISTS installer_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
    installer_id uuid NOT NULL,
    order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
    payment_date timestamptz DEFAULT now(),
    amount numeric NOT NULL DEFAULT 0,
    payment_method text,
    note text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS installation_errors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
    installer_id uuid,
    error_date timestamptz DEFAULT now(),
    description text NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- 9. Reporting RPC for date range dashboards
CREATE OR REPLACE FUNCTION get_modular_saas_report(p_company_id uuid, p_start date, p_end date)
RETURNS TABLE (
    total_sales numeric,
    total_profit numeric,
    total_supplier_debt numeric,
    total_supplier_payment numeric,
    total_installer_payment numeric,
    pending_orders bigint,
    completed_orders bigint
)
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE((SELECT SUM(o.total_amount) FROM orders o WHERE o.company_id = p_company_id AND o.created_at::date BETWEEN p_start AND p_end), 0),
        COALESCE((SELECT SUM(COALESCE(o.gross_profit, o.profit, COALESCE(o.total_amount, 0) - COALESCE(o.fabric_cost, 0) - COALESCE(o.mechanism_cost, 0) - COALESCE(o.installation_cost, 0))) FROM orders o WHERE o.company_id = p_company_id AND o.created_at::date BETWEEN p_start AND p_end), 0),
        COALESCE((SELECT SUM(swo.total_cost) FROM supplier_work_orders swo WHERE swo.company_id = p_company_id AND swo.created_at::date BETWEEN p_start AND p_end), 0),
        COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.company_id = p_company_id AND sp.payment_date::date BETWEEN p_start AND p_end), 0),
        COALESCE((SELECT SUM(ip.amount) FROM installer_payments ip WHERE ip.company_id = p_company_id AND ip.payment_date::date BETWEEN p_start AND p_end), 0),
        COALESCE((SELECT COUNT(*) FROM orders o WHERE o.company_id = p_company_id AND o.created_at::date BETWEEN p_start AND p_end AND COALESCE(o.status, '') NOT IN ('paid', 'completed', 'done', 'cancelled')), 0),
        COALESCE((SELECT COUNT(*) FROM orders o WHERE o.company_id = p_company_id AND o.created_at::date BETWEEN p_start AND p_end AND COALESCE(o.status, '') IN ('paid', 'completed', 'done')), 0);
END;
$$;
