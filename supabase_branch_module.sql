-- =========================================================
-- MULTI-BRANCH (FRANCHISE) MODULE FOR CURTAIN SAAS
-- =========================================================

-- 1. Modifying the companies table to support hierarchy
ALTER TABLE companies ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_branch boolean DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS branch_code text;

-- 2. RPC to create a branch (Safe approach without touching complex RLS)
CREATE OR REPLACE FUNCTION create_branch(
    p_parent_id uuid,
    p_name text,
    p_code text,
    p_invite_code text
) RETURNS uuid
SECURITY DEFINER
AS $$
DECLARE
    new_company_id uuid;
BEGIN
    -- Only admin or super_admin of the parent company can create a branch
    IF NOT EXISTS (
        SELECT 1 FROM company_members cm 
        JOIN profiles p ON p.user_id = cm.user_id
        WHERE cm.company_id = p_parent_id AND cm.user_id = auth.uid() AND (p.role = 'admin' OR p.role = 'super_admin')
    ) THEN
        RAISE EXCEPTION 'Yetkisiz islem. Sadece yoneticiler sube acabilir.';
    END IF;

    -- Create new company (Branch)
    INSERT INTO companies (name, parent_id, is_branch, branch_code, created_at)
    VALUES (p_name, p_parent_id, true, p_code, now())
    RETURNING id INTO new_company_id;

    -- Pre-create the Branch Manager employee card so they can sign up with the invite code
    INSERT INTO employees (company_id, full_name, target_role, invite_code, created_at)
    VALUES (new_company_id, 'Sube Yoneticisi', 'admin', upper(trim(p_invite_code)), now());

    RETURN new_company_id;
END;
$$ LANGUAGE plpgsql;

-- 3. RPC to fetch consolidated branch stats for the parent admin
CREATE OR REPLACE FUNCTION get_branch_stats(p_parent_id uuid)
RETURNS TABLE (
    company_id uuid,
    name text,
    total_sales numeric,
    total_collection numeric,
    total_expense numeric,
    is_branch boolean,
    created_at timestamptz
)
SECURITY DEFINER
AS $$
BEGIN
    -- Ensure caller is authorized
    IF NOT EXISTS (
        SELECT 1 FROM company_members cm 
        WHERE cm.company_id = p_parent_id AND cm.user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Yetkisiz islem.';
    END IF;

    RETURN QUERY
    SELECT 
        c.id,
        c.name,
        COALESCE((SELECT SUM(o.total_amount) FROM orders o WHERE o.company_id = c.id AND o.status != 'cancelled'), 0) as total_sales,
        COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.company_id = c.id AND t.type = 'income'), 0) as total_collection,
        COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.company_id = c.id AND t.type = 'expense'), 0) as total_expense,
        c.is_branch,
        c.created_at
    FROM companies c
    WHERE c.parent_id = p_parent_id OR c.id = p_parent_id
    ORDER BY c.is_branch ASC, c.created_at DESC;
END;
$$ LANGUAGE plpgsql;
