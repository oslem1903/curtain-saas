# PerdePRO lansman kampanyası — yıllık paket %50 (ilk 20 işletme)

Durum: KOD HAZIR, **hiçbir şey canlıya uygulanmadı** (migration, Edge Function, site, web yayını yapılmadı).
Kampanya migration ile **kapalı** (`is_enabled=false`) gelir; açmak ayrı bir adımdır.

## Kurallar (hepsi sunucuda)
- Yıllık plan 4.990 TL → kampanyalı ilk yıl 2.495 TL (249500 kuruş), KDV dahil. Aylık 499 TL değişmez.
- Yalnız işletmenin ilk başarılı yıllık satın alımı; ilk 20 farklı işletme; bir işletme bir kez.
- Tutar `billing_intents.amount_minor` içinde sabitlenir (PayTR'ye giden tutar = niyet tutarı = callback'te beklenen tutar).
- Ödeme başlarken süreli rezervasyon (PayTR `timeout_limit` 30 dk + 15 dk tampon = 45 dk); bekleyen rezervasyon kontenjana sayılır.
- Kontenjanı yalnız doğrulanmış başarılı ödeme (`billing_apply_charge`) kesinleştirir. Başarısız/iptal/süresi dolan/PayTR TEST ödemeleri tüketmez.
- Aynı bildirim tekrar gelirse lisans süresi ve kontenjan değişmez (olay + ödeme benzersizliği).
- Gecikmiş bildirim: yer boşsa ve işletme daha önce yararlanmadıysa kesinleşir; değilse **lisans açılmaz**, olay
  `rejected_campaign_unavailable_refund_required` olarak yazılır → PayTR panelinden **manuel iade** gerekir.
- Otomatik yenileme yok; sonraki dönem o günkü plan fiyatı.
- **Elle verilmiş ücretli yıllık lisans** kampanyadan dışlar: faturalama ödemesi olmayan `plan_status='active'` firma ücretli sayılır.
  Deneme (`trial`) ve özel erişim/hediye (`is_pilot`) dışlamaz. Otomatik tespit temkinlidir; süper admin Firma Detay →
  "Lansman kampanyası uygunluğu" kartından `Hediye/ücretsiz say` veya `Ücretli yıllık say` istisnası koyar.
  Süresi dolmuş eski elle lisanslar otomatik tespit EDİLEMEZ; bilinenleri `Ücretli yıllık say` ile işaretleyin. Aday listesi (salt okunur):
  `select id,name,plan_status,license_expires_at from companies where license_expires_at is not null and not exists (select 1 from billing_payments p where p.company_id=companies.id);`
- **Manuel iade takibi**: gecikmiş başarılı ödeme + dolu kontenjan → `billing_refund_cases` (açık). Süper admin → Lisans Yönetimi üstünde
  kırmızı "MANUEL İADE BEKLEYEN ÖDEMELER" kartı (PayTR referansı, tutar, firma); PayTR panelinden iade edip referansla kapatın.
  Firma yöneticisi Abonelik ekranında "Lisansınız AÇILMADI — ödemeniz iade edilecek" uyarısını görür; başarı mesajı gösterilmez.

## Uygulama sırası (hepsi sizde / onayınızla)
1. `supabase_migration_039_launch_campaign.sql` → Supabase SQL Editor (önkoşul 033–036 uygulanmış). Geri alma: `supabase_migration_039_rollback.sql`.
2. Edge Function `billing-checkout` yeniden dağıtın (`supabase functions deploy billing-checkout`). `paytr-callback` DEĞİŞMEDİ.
   Sıra önemli: önce migration, sonra function. (Yeni function eski RPC ile çalışmaz; eski function yeni RPC ile çalışır.)
3. Web uygulaması (Vercel) yayını — `Subscription.tsx` kampanya kartı, süper admin kartı, giriş sonrası `/subscription` dönüşü.
4. Site (ozidijital-web) yaması: `marketing/ozidijital-web-perdepro-launch-campaign.patch`; Vercel ortam değişkenleri
   `PERDEPRO_SUPABASE_URL`, `PERDEPRO_SUPABASE_ANON_KEY` (anon/publishable). Yoksa site kampanyayı göstermez (güvenli).
5. Hepsi canlıyken kampanyayı AÇ (SQL Editor): `select public.billing_campaign_set_enabled('launch_solo_yearly_50', true);`
   KAPAT: `... , false);` (veya süper admin → Lisans Yönetimi → "Kampanyayı kapat").
6. PayTR TEST modunda (Metraj360 yönlendirmesiyle; `scripts/verify-paytr-test-payment.mjs start/check/replay` kampanyalı yıllık plan için) (QA firması `billing_test_companies`) uçtan uca deneyin; gerçek kart çekimi yapmayın.

## Testler
- `node tests/billing/campaign.integration.mjs` (PGlite, gerçek migration + gerçek Edge Function kodu, 73 kontrol)
- `PG_TEST_MODULES=<embedded-postgres+pg klasörü> node tests/billing/campaign.concurrency.mjs` (gerçek PostgreSQL, eşzamanlı)
- Callback zinciri (PayTR → Metraj360 → PerdePRO) yerel simülasyonu: `METRAJ_REPO=<oslem1903/metraj360 klasörü> node tests/billing/campaign.integration.mjs`
  (Metraj'ın GERÇEK paytr-callback kaynağı + PerdePRO callback; 73 kontrol). **Gerçek PayTR test ödemesi henüz yapılmadı** (migration/function canlıda yok).
- `node tests/billing/callback.integration.mjs` (mevcut akış, 039 ile de geçer)

## QA-only test (kampanya genel olarak KAPALI kalır)
`qa_preview=true` iken kampanya yalnız `billing_test_companies` firmalarına uygulanır; site ve diğer firmalar normal fiyat görür.
```
-- QA firması test listesinde olmalı (BILLING_PAYTR_ROUTING.md); kampanya is_enabled=false kalır:
update public.billing_campaigns set qa_preview = true where code = 'launch_solo_yearly_50';   -- test bitince false
```
PerdePRO `PAYTR_TEST_MODE=1` iken yalnız test firmaları ödeme başlatabilir; ortak PayTR mağazasındaki Metraj360 (`MTR…`) ödemeleri
bu yoldan geçmez (Metraj360 yalnız `PRD…` siparişlerini iletir). Gerçek kart çekilmez: PayTR test kartı kullanılır.

## Yayın notu (web uygulaması)
`release/1.0.14-access-trial7` dalı artık iOS/hesap silme işini de içerir; web'i yayınlamadan önce
`supabase/migrations/20261029100000_account_deletion_requests.sql` (ACCOUNT_DELETION_OPERATIONS.md) canlıda uygulanmış olmalı,
aksi halde "Hesabımı sil" ekranı çalışmaz.
