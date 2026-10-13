# PerdePRO Solo satın alma — PayTR kurulum ve tek mağaza yönlendirmesi

Durum (2026-10-13, 2. tur): migration 033/034/035 üretimde UYGULANDI. Planlar tanımlı (KDV dahil, TRY):
`solo_monthly` 499 TL / 1 ay, `solo_yearly` 4.990 TL / 1 yıl; ikisi de `is_purchasable=false` (fiyat görünür, ödeme KAPALI).
Edge Function'lar `billing-checkout` ve `paytr-callback` PerdePRO projesine DAĞITILDI ama PayTR secret'ları tanımlı değil:
`billing-checkout` 503 `billing_disabled` döner, `paytr-callback` 503 "not configured".

## Tek mağaza yönlendirmesi (UYGULANDI ve Metraj360 üretiminde dağıtıldı)
PayTR mağaza başına TEK Bildirim URL'si kullanır; PayTR panelindeki mevcut URL (Metraj360'ınki) DEĞİŞMEZ.
Metraj360 (`ijnfxovtochayjorlmrj`, "OZI") `paytr-callback` fonksiyonu (v7) hash'i doğruladıktan sonra yalnızca
`merchant_oid` = `PRD` + 32 hex olan (PerdePRO) siparişleri aynı form gövdesiyle PerdePRO `paytr-callback`'ine iletir.
**Yalnızca 2xx HTTP durumu VE tam `OK` gövdesi** varsa PayTR'ye `OK` döner; aksi halde 502 (PayTR yeniden dener).
`MTR…` yolu değişmedi. Kod: `oslem1903/metraj360` PR #28 (birleştirildi); test: `node supabase/tests/paytr-callback-forward.check.mjs`.
Metraj360'ta `PERDEPRO_CALLBACK_URL` secret'ı tanımlı ve değeri doğrulandı (özet eşleşti).

## Kalan panel adımları (siz) — PerdePRO Supabase `ffhmzlcsgsgjonqqhgqq` (perdepro)
**A. Edge Functions → Secrets** (anahtarlar sohbete yazılmaz):
| Secret | Değer |
|---|---|
| `BILLING_ENABLED` | `1` |
| `PAYTR_MERCHANT_ID` / `PAYTR_MERCHANT_KEY` / `PAYTR_MERCHANT_SALT` | Metraj360'la AYNI mağazanın değerleri |
| `APP_PUBLIC_URL` | `https://oslem1903-curtain-saas.vercel.app` |
| `ALLOWED_ORIGINS` | `https://oslem1903-curtain-saas.vercel.app` |
| `PAYTR_TEST_MODE` | `1` |

**B. Edge Functions → `paytr-callback` → Settings**: "Verify JWT with legacy secret" **KAPALI** → Save.

PayTR panelinde değişiklik YOK. `billing_test_companies` içinde yalnızca QA firması B (`53ea4c27-…`, Test Company 2) vardır.

## Test ödemesi ve kanıt (herkese açık satın alma bunlar kanıtlanana kadar KAPALI kalır)
```
node scripts/verify-paytr-test-payment.mjs start    # test odeme sayfasi adresi; PayTR test karti ile ode
node scripts/verify-paytr-test-payment.mjs check    # tam 1 odeme, lisans yalniz 1 donem uzadi
# kendi terminalinizde, anahtarlar ortam degiskeni olarak (yazdirilmaz):
node scripts/verify-paytr-test-payment.mjs replay   # ayni bildirim yeniden: odeme/lisans DEGISMEZ
```
Sonra (kanıt tamamsa): `PAYTR_TEST_MODE` secret'ını sil ve
`update billing_plans set is_purchasable=true where code in ('solo_monthly','solo_yearly');`

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
