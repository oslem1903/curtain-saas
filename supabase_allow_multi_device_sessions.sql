-- Allows the same account to be used on desktop and mobile at the same time.
-- Run once in Supabase SQL Editor if older setup scripts added device locks.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bound_device_id text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false;

UPDATE public.profiles
SET bound_device_id = NULL,
    is_locked = false
WHERE bound_device_id IS NOT NULL
   OR is_locked IS DISTINCT FROM false;
