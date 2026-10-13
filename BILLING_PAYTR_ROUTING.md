# PerdePRO Solo satın alma — PayTR kurulum ve tek mağaza yönlendirmesi

Durum (2026-10-13, 2. tur): migration 033/034/035 üretimde UYGULANDI. Planlar tanımlı (KDV dahil, TRY):
`solo_monthly` 499 TL / 1 ay, `solo_yearly` 4.990 TL / 1 yıl; ikisi de `is_purchasable=false` (fiyat görünür, ödeme KAPALI).
Edge Function'lar `billing-checkout` ve `paytr-callback` PerdePRO projesine DAĞITILDI ama PayTR secret'ları tanımlı değil:
`billing-checkout` 503 `billing_disabled` döner, `paytr-callback` 503 "not configured".

## Ödemeyi açmak için kalan adımlar (sırayla; anahtarlar sohbete yazılmaz)
1. **paytr-callback JWT doğrulamasını kapat** (Dashboard → Edge Functions → paytr-callback → Settings →
   "Verify JWT with legacy secret" KAPALI → Save). PayTR sunucusu Authorization göndermez; güvenlik fonksiyon içindeki
   HMAC doğrulamasıdır. (Bu ayar otomatik denetimce reddedildiği için elle yapılmalı.)
2. **Secret'ları ekle** (Dashboard → Edge Functions → Secrets, yetkili operatör): `BILLING_ENABLED=1`, `PAYTR_MERCHANT_ID`,
   `PAYTR_MERCHANT_KEY`, `PAYTR_MERCHANT_SALT`, `APP_PUBLIC_URL=https://oslem1903-curtain-saas.vercel.app`,
   `ALLOWED_ORIGINS=https://oslem1903-curtain-saas.vercel.app`, **`PAYTR_TEST_MODE=1`**.
3. **PayTR panelinde Bildirim URL**: `https://ffhmzlcsgsgjonqqhgqq.supabase.co/functions/v1/paytr-callback` (tek mağaza ise
   aşağıdaki yönlendirme bölümüne bakın).
4. **Test firması**: `insert into billing_test_companies(company_id) values ('<QA firma id>');` ve aynı firma için
   `update billing_plans set is_purchasable=true where code='solo_monthly';` (test süresince yalnızca bu firma ödeme başlatabilir).
5. **Test modu doğrulama**: QA hesabıyla uygulamada Abonelik → "Ödemeye geç"; PayTR test kartı ile ödeme; bildirimden sonra
   `billing_payments` 1 satır, firma `plan_status=active`; aynı bildirimi tekrar gönder → süre değişmez.
6. **Canlıya alma**: `PAYTR_TEST_MODE` secret'ını sil/0 yap; `update billing_plans set is_purchasable=true where code in
   ('solo_monthly','solo_yearly');` Ardından tek bir gerçek ödemeyi sahibi kendisi doğrular.

Kontrol betikleri: `node scripts/verify-billing-plans.mjs` (plan/fiyat/kapalı anahtar), `node scripts/verify-paytr-functions.mjs`
(dağıtım durumu), `node tests/billing/callback.integration.mjs` (callback mantığı, yerel PGlite).

## Tek mağaza mümkün mü? (resmi PayTR iFrame API 2. adım)
- Bildirim URL'si **mağaza başına tek** ve PayTR mağaza panelinde (Ayarlar) tanımlanır; istek başına gönderilen bir
  callback parametresi yoktur (`merchant_ok_url/fail_url` yalnızca müşteri yönlendirmesidir).
- Metraj360 callback'i bilinmeyen siparişe `OK` döndüğü için, aynı mağazayı kullanan PerdePRO siparişleri (`PRD…`)
  Metraj360'a düşer, "unknown_order" sayılır ve PerdePRO'ya hiç ulaşmaz → lisans açılmaz.
- Güvenilir yönlendirme için iki yol:
  1. **Ayrı PayTR mağazası** (önerilen, sıfır risk): PerdePRO kendi `PAYTR_MERCHANT_*` değerleriyle, kendi Bildirim URL'siyle çalışır.
  2. **Tek mağaza + yönlendirme**: Metraj360 `paytr-callback`'i, hash'i doğruladıktan sonra `merchant_oid` öneki `PRD` olan
     bildirimi aynı form gövdesiyle PerdePRO `paytr-callback`'ine iletir; yalnızca PerdePRO `OK` dönerse `OK` döner,
     hata/zaman aşımında `OK` DÖNMEZ (PayTR yeniden dener). `MTR…` yolu hiç değişmez. PerdePRO tarafı `PRD` önekli ve
     kendi hash'ini yeniden doğrulayan siparişleri işler (kod hazır: `supabase/functions/paytr-callback`).
- Tek mağazada iki projenin de aynı merchant key/salt'ı sunucu gizli değişkeni olarak taşıması gerekir.

## Anahtarlar (sohbete yazılmaz)
Supabase Edge secret'ları yazılabilir ama okunamaz; mevcut Metraj360 değerleri buradan alınamaz. Yetkili operatör kendi
terminalinde, PerdePRO projesi (`ffhmzlcsgsgjonqqhgqq`) için:
```
npx supabase secrets set BILLING_ENABLED=1 PAYTR_MERCHANT_ID=... PAYTR_MERCHANT_KEY=... PAYTR_MERCHANT_SALT=... \
  APP_PUBLIC_URL=https://oslem1903-curtain-saas.vercel.app ALLOWED_ORIGINS=https://oslem1903-curtain-saas.vercel.app \
  PAYTR_TEST_MODE=1 --project-ref ffhmzlcsgsgjonqqhgqq
npx supabase functions deploy billing-checkout --project-ref ffhmzlcsgsgjonqqhgqq
npx supabase functions deploy paytr-callback --no-verify-jwt --project-ref ffhmzlcsgsgjonqqhgqq
```
`PAYTR_TEST_MODE=1` iken yalnızca `billing_test_companies` tablosundaki QA firmaları ödeme başlatabilir ve test
ödemeleri gerçek firmanın lisansını açmaz.

## Plan ekleme (fiyat ONAYLANINCA; şu an uydurma değer yok)
```sql
insert into billing_plans(code,name,period,price_minor,package_code)
values ('solo_monthly','PerdePRO Solo Aylık','month', <kuruş>, 'solo');
```
