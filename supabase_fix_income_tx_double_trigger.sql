-- ============================================================
-- PERDEPRO - fn_tx_from_income / fn_tx_from_expense reversal fix
--
-- BULGU (canli DB'den pg_get_functiondef ile dogrulandi, ffhmzlcsgsgjonqqhgqq):
--   income tablosunda AYNI ANDA IKI "AFTER INSERT" trigger var:
--     1) trg_tx_from_income  -> fn_tx_from_income()   (DOGRU: abs(new.amount),
--        direction new.amount<0 ise 'out' degilse 'in')
--     2) trg_income_to_tx    -> fn_income_to_tx()      (ESKI/ARTIK KALINTI:
--        new.amount'u OLDUGU GIBI (abs YOK) yaziyor, direction sabit 'in')
--
--   customer_cancel_collection RPC'si iptal sirasinda income'a NEGATIF
--   amount'lu bir "iptal" satiri ekliyor (bkz. supabase_customer_collection_
--   finance_rpc.sql). Bu satir insert edilince HER IKI trigger da calisiyor:
--   fn_tx_from_income basariyla abs() ile pozitif yazarken, fn_income_to_tx
--   negatif degeri OLDUGU GIBI yazmaya calisiyor ve
--   "transactions_amount_positive" (CHECK amount IS NULL OR amount >= 0)
--   ihlali ile TUM insert (dolayisiyla tum RPC transaction'i) rollback
--   oluyor. Bu yuzden OrderDetail.tsx "Tahsilatı İptal Et" her zaman
--   basarisiz oluyor.
--
--   Ayrica bu ikinci (eski) trigger normal (pozitif) tahsilatlarda da HER
--   income insert'inde transactions tablosuna FAZLADAN bir satir daha
--   ekliyor (cift sayim) - bu RPC'nin YARATTIGI bir sorun degil, oncesinden
--   var olan bir kalinti/celiski.
--
--   expenses tablosunda boyle bir cift trigger YOK (yalniz trg_tx_from_expense
--   var, fn_tx_from_expense zaten abs()/direction'i dogru uyguluyor) - bu
--   yuzden tedarikci odeme iptali (supplier_cancel_payment) constraint hatasi
--   VERMIYOR; Suppliers.tsx'teki "bakiye degismiyor" sorunu ayri, kod
--   tarafinda (bkz. Suppliers.tsx degisikligi).
--
-- FIX: yalnizca kalinti/cift trigger'i kaldir. fn_tx_from_income VE
-- fn_tx_from_expense'e (zaten istenen mantigi dogru uyguladiklari icin)
-- DOKUNULMUYOR. fn_income_to_tx fonksiyonu da SILINMIYOR (baska bir yerden
-- cagirilma ihtimaline karsi, zaten trigger'i olmadan calismaz) - yalnizca
-- trigger baglantisi kesiliyor.
-- ============================================================

DROP TRIGGER IF EXISTS trg_income_to_tx ON public.income;

-- SONUC
SELECT 'SONUC: trg_income_to_tx kaldirildi, income artik yalniz fn_tx_from_income uzerinden transactions''a yaziyor' AS check_name,
       NOT EXISTS (
         SELECT 1 FROM pg_trigger tg
         JOIN pg_class rel ON rel.oid = tg.tgrelid
         WHERE rel.relname = 'income' AND tg.tgname = 'trg_income_to_tx'
       ) AS ok;
