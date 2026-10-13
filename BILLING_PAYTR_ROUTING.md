# PerdePRO Solo satın alma — PayTR kurulum ve tek mağaza yönlendirmesi

Durum (2026-10-13): migration 033 üretimde UYGULANDI (billing_* tabloları boş, plan yok). Edge Function'lar
(`billing-checkout`, `paytr-callback`) yazıldı ama DAĞITILMADI; PayTR anahtarları PerdePRO projesinde tanımlı değil.
Satın alma bilerek kapalı: `billing_plans` boş olduğu için uygulama "paket fiyatları henüz açıklanmadı" gösterir.

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
