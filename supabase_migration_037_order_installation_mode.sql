-- 037: Siparişte "Kendim yapıyorum" seçimini montaj işi oluşmadan da saklamak için.
-- Additive: nullable kolon, mevcut kayıtlar NULL (= seçim yapılmadı) kalır. Veri değiştirilmez.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS installation_mode text
  CHECK (installation_mode IS NULL OR installation_mode IN ('self'));
COMMENT ON COLUMN public.orders.installation_mode IS
  'self = montajı firma kendisi yapıyor (dış montaj maliyeti 0). NULL = seçim yok (Kendim yapıyorum DEĞİL).';
