# PerdePRO test ortamı (staging) kurulumu

Amaç: üretim verisine dokunmadan gerçek UI → Auth → Supabase → Edge Function → webhook zincirini denemek.
Üretimden **yalnızca şema** alınır; müşteri verisi, Auth kullanıcıları ve sırlar klonlanmaz.

## Sizin yapacağınız panel adımları (kısa)
1. supabase.com → New project: ad `perdepro-staging`, **Free** plan, bölge üretimle aynı (`ap-south-1`), güçlü veritabanı şifresi (kimseyle paylaşmayın). Ücretli plana geçmeyin.
2. Authentication → URL Configuration: Site URL ve Redirect URLs'e test sitesi adresini ve `com.curtainsaas.app://auth/callback` ekleyin; "Confirm email" **açık**.
3. Project Settings → API: proje ref'ini (20 karakter) not edin. `service_role` anahtarını **kimseyle paylaşmayın**.
4. Settings → Database → Connection string → *Session pooler* ana bilgisayarını not edin.

## Benim hazırladığım / sizin çalıştıracağınız adımlar
```powershell
cd C:\Users\Oslem\Desktop\curtain-saas
powershell -ExecutionPolicy Bypass -File scripts\staging\clone-schema.ps1 -StagingRef <YENI_PROJE_REF>
```
Betik: üretimden `pg_dump --schema-only`, dumpta veri satırı olmadığını doğrular, test projesine uygular, tohum planlarını yazar. Şifreler yalnızca gizli istemde girilir.

Sonra (test projesine bağlıyken, depo kökünde):
```powershell
npx supabase link --project-ref <YENI_PROJE_REF>
npx supabase db query --linked -f supabase_migration_030_super_admin_company_membership.sql
npx supabase db query --linked -f supabase_migration_032_billing_core_DRAFT.sql
npx supabase db query --linked -f scripts\staging\seed-staging.sql
```
> `supabase link` sonrası CLI test projesine bağlı kalır. Üretime dönmek için: `npx supabase link --project-ref ffhmzlcsgsgjonqqhgqq` ve `npm run check:link`.

Edge Function'lar (test projesinde):
```powershell
npx supabase functions deploy billing-checkout
npx supabase functions deploy billing-callback --no-verify-jwt
npx supabase functions deploy billing-webhook-iyzico --no-verify-jwt
```
Gizli değerler (kendi terminalinizde; sohbete yazmayın):
```powershell
npx supabase secrets set IYZICO_API_KEY=... IYZICO_SECRET_KEY=... IYZICO_BASE_URL=<sandbox-adresi> BILLING_ENABLED=1 APP_PUBLIC_URL=https://<test-site>
```
`IYZICO_BASE_URL` zorunludur (varsayılan yok). iyzico'nun resmi sayfaları yalnızca canlı adresi (`api.iyzipay.com`) gösteriyor; **sandbox adresini iyzico sandbox panelinden/destekten doğrulayın**, canlı adresi test ortamına vermeyin.

Sandbox panelinde: Ayarlar → İşyeri Bildirimleri → webhook URL'si `https://<test-proje>.supabase.co/functions/v1/billing-webhook-iyzico`; imzalı bildirim (`X-IYZ-SIGNATURE-V3`) için entegrasyon@iyzico.com ile etkinleştirme.

## Test sitesi
Vercel'de ayrı bir **Preview** ortam değişkeni seti (yalnızca `staging` dalı için): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (test projesinin), `VITE_BILLING_ENABLED=1`. Üretim projelerinin değişkenlerine dokunulmaz.

## Depolama politikaları (isteğe bağlı)
`npx supabase db query --linked -f scripts\staging\export-storage-policies.sql` (üretime bağlıyken) çıktısını test projesinde SQL Editor'da çalıştırın.

## Gerçek uçtan uca test (hazır olunca)
`scripts\staging\e2e-staging.mjs` — ortam değişkenleri `STAGING_URL`, `STAGING_SERVICE_KEY`, `STAGING_ANON_KEY` (kendi terminalinizde).
Adımlar: 7 gün kilidi (doğrudan API) → açık onay olmadan ödeme başlamaz → iyzico sandbox tek seferlik ödeme (elle) → doğrulanmış webhook/callback → erişim açılması → tek ödeme kaydı.
