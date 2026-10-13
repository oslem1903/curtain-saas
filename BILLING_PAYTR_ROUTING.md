# PerdePRO Solo satın alma — PayTR kurulum ve tek mağaza yönlendirmesi

Durum (2026-10-13, 2. tur): migration 033/034/035 üretimde UYGULANDI. Planlar tanımlı (KDV dahil, TRY):
`solo_monthly` 499 TL / 1 ay, `solo_yearly` 4.990 TL / 1 yıl; ikisi de `is_purchasable=false` (fiyat görünür, ödeme KAPALI).
Edge Function'lar `billing-checkout` ve `paytr-callback` PerdePRO projesine DAĞITILDI ama PayTR secret'ları tanımlı değil:
`billing-checkout` 503 `billing_disabled` döner, `paytr-callback` 503 "not configured".

## Tek mağaza yönlendirmesi (uygulandı, Metraj360 PR'ında; deploy bekliyor)
PayTR mağaza başına TEK Bildirim URL'si kullanır; PayTR panelindeki mevcut URL (Metraj360'ınki) DEĞİŞMEZ.
Metraj360 `paytr-callback` fonksiyonu hash'i doğruladıktan sonra yalnızca `merchant_oid` = `PRD` + 32 hex olan
(PerdePRO) siparişleri aynı form gövdesiyle PerdePRO `paytr-callback`'ine iletir; PerdePRO `OK` dönmezse `OK`
DÖNMEZ (PayTR yeniden dener). `MTR…` (Metraj360) yolu hiç değişmez. Kod: `oslem1903/metraj360` PR #28
(`supabase/functions/paytr-callback`, test: `node supabase/tests/paytr-callback-forward.check.mjs`).

## Panel adımları — TEK LİSTE (anahtarlar sohbete yazılmaz; Supabase secret'ları yazılabilir ama okunamaz)
**A. PerdePRO Supabase projesi `ffhmzlcsgsgjonqqhgqq` (perdepro) → Edge Functions → Secrets**
| Secret | Değer |
|---|---|
| `BILLING_ENABLED` | `1` |
| `PAYTR_MERCHANT_ID` | Metraj360'ın kullandığı AYNI mağazanın merchant id'si |
| `PAYTR_MERCHANT_KEY` | aynı mağazanın merchant key'i |
| `PAYTR_MERCHANT_SALT` | aynı mağazanın merchant salt'ı |
| `APP_PUBLIC_URL` | `https://oslem1903-curtain-saas.vercel.app` |
| `ALLOWED_ORIGINS` | `https://oslem1903-curtain-saas.vercel.app` |
| `PAYTR_TEST_MODE` | `1` (test bitene kadar) |

**B. PerdePRO → Edge Functions → `paytr-callback` → Settings**: "Verify JWT with legacy secret" **KAPALI** → Save.
(PayTR/Metraj360 sunucusu Authorization göndermez; güvenlik fonksiyon içindeki HMAC doğrulamasıdır.)

**C. Metraj360 Supabase projesi → Edge Functions → Secrets**: `PERDEPRO_CALLBACK_URL` =
`https://ffhmzlcsgsgjonqqhgqq.supabase.co/functions/v1/paytr-callback`
Ardından PR #28 birleştirilip Metraj360 `paytr-callback` yeniden dağıtılır (JWT doğrulaması Metraj360'ta zaten kapalıdır).
Bu adım yapılana kadar PRD siparişleri Metraj360'ta 503 alır (PayTR yeniden dener); MTR ödemeleri etkilenmez.

**D. PayTR mağaza paneli**: Bildirim URL'si DEĞİŞMEZ (mevcut Metraj360 adresi kalır).

**E. Test firmasını işaretle** (PerdePRO SQL Editor; kendi e-postanızla):
```sql
insert into billing_test_companies(company_id)
select cm.company_id from company_members cm join auth.users u on u.id = cm.user_id
where lower(u.email) = lower('<e-posta>') and cm.role = 'admin' on conflict do nothing;
```
Bu firma deneme/lisans tarihlerine DOKUNMAZ; yalnızca bu firma için Abonelik ekranında "Test ödemesine geç" düğmesi açılır.

## Test ödemesi ve kanıt (herkese açık satın alma bunlar kanıtlanana kadar KAPALI kalır)
1. Test firmasıyla Abonelik → "Test ödemesine geç" → PayTR test kartı (gerçek para çekilmez, `test_mode=1`).
2. Beklenen: `billing_intents.status='paid'`, `billing_payments` 1 satır, `billing_events.outcome='applied'`,
   firma `plan_status='active'` ve `license_expires_at` kalan süre + 1 dönem.
3. Aynı bildirimi yeniden gönder (PayTR panelinden tekrar veya `curl`): `outcome='duplicate_payment'`, süre DEĞİŞMEZ.
4. Başarı sayfasına dönüş (`?payment=pending`) tek başına lisans açmaz (yalnızca doğrulanmış callback açar).
5. Test firmasında doğrulanınca: `PAYTR_TEST_MODE` secret'ını sil, sonra
   `update billing_plans set is_purchasable=true where code in ('solo_monthly','solo_yearly');` (herkese açık satın alma).

Kontrol betikleri: `node scripts/verify-billing-plans.mjs`, `node scripts/verify-paytr-functions.mjs`,
`node tests/billing/callback.integration.mjs` (yerel PGlite).

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
