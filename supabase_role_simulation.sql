-- Add assignment columns to appointments
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS assigned_role text;

-- Drop old RLS if exists that might conflict, or just append new ones.
-- The user said: "Montajcı / ölçü personeli sadece assigned_user_id kendi user_id’sine eşit olan randevuları görebilsin."
-- We need to update the appointment RLS to allow access if assigned_user_id = auth.uid()
-- Assuming existing policy handles admin/company isolation. We will add a policy for assigned users.
CREATE POLICY "Users can access assigned appointments" ON public.appointments
    FOR ALL
    USING (
        assigned_user_id = auth.uid()
        OR
        created_by = auth.uid()
    )
    WITH CHECK (
        assigned_user_id = auth.uid()
        OR
        created_by = auth.uid()
    );

-- Enable realtime for specified tables
alter publication supabase_realtime add table public.appointments;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.customers;
alter publication supabase_realtime add table public.payments;
alter publication supabase_realtime add table public.income;
alter publication supabase_realtime add table public.expenses;
