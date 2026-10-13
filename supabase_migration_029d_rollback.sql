-- Migration 029d geri alma: yalnizca 029d'nin eklediği fonksiyonu kaldirir.
-- Istemci (SupportModal) fonksiyon yoksa eki yine yukler; yalnizca talebe baglama basarisiz uyarisi gorunur.
BEGIN;
DROP FUNCTION IF EXISTS public.attach_support_ticket_screenshot(uuid, text);
NOTIFY pgrst, 'reload schema';
COMMIT;
