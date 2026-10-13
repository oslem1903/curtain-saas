# PerdePRO Abonelik / Ödeme Mimarisi (TASLAK)

Durum: ESKI (iyzico) TASARIM TASLAGI; guncel PayTR akisi icin BILLING_PAYTR_ROUTING.md ve migration 033-035 gecerlidir.
Üretime uygulanmadı, hiçbir sağlayıcı hesabı açılmadı, **canlı/sandbox ödeme akışı test edilmedi**, çalışan satın alma yoktur.

## Ödeme modeli: tek seferlik dönem satın alımı
- iyzico **Checkout Form (tek seferlik ödeme)** kullanılır; iyzico "Abonelik" ürünü (otomatik yenileme) **kullanılmaz**.
- Kullanıcı aylık veya yıllık dönemi **açık onayla** (onay kutusu; sunucu `accepted_terms` olmadan başlatmaz) satın alır.
- Kart saklanmaz, otomatik yenileme/tahsilat yoktur. Yenileme = kullanıcının yeniden satın alması (bitişten önce hatırlatma ayrı iş).
- Fiyat ve plan sunucuda belirlenir (`billing_plans`); satın alma **niyeti** (`billing_intents`) tutarı sabitler.

## Bugünkü durum (kanıtlı)
- Uygulama içi "Satın Al" bir WhatsApp bağlantısıdır; lisansı süper admin elle açar.
- Sunucuda yazma kilidi çalışır: `company_subscription_allows_write()` + `trg_subscription_write_guard` +
  `protect_license_fields` (kullanıcı kendi lisansını/özel erişimini değiştiremez).

## Akış
```
Kullanıcı (web/Windows) ─ onay kutusu ─> billing-checkout (JWT, firma yöneticisi) ─> niyet oluştur (fiyat sunucudan)
      ─> iyzico ödeme sayfası ─> (a) billing-callback (tarayıcı)   (b) billing-webhook-iyzico (sunucu, imzalı)
                                       └──────────── ortak doğrulama ────────────┘
        token ile iyzico'dan sonucu SUNUCUDA sorgula → paymentStatus=SUCCESS, fraudStatus=1,
        paidPrice+currency == niyet → billing_apply_charge (idempotent) → companies.license_expires_at uzar
```
Başarı sayfasına gitmek veya istemci verisi erişim açmaz; yalnızca sunucuda doğrulanmış ödeme açar.

## Tablolar (taslak: `supabase_migration_032_billing_core_DRAFT.sql`)
| Tablo | Amaç |
|---|---|
| `billing_plans` | Plan kodu, dönem (ay/yıl), fiyat, para birimi, paket |
| `billing_intents` | Satın alma niyeti: firma, plan, sunucuda sabitlenen tutar, durum |
| `billing_subscriptions` | Firma başına **tek canlı** kayıt (kısmi benzersiz indeks); kanal, dönem sonu |
| `billing_events` | Mükerrer bildirim engeli: `UNIQUE(channel, provider_event_id)` |
| `billing_payments` | Tahsilat/iade satırları, `UNIQUE(channel, provider_payment_id, kind)` |

İstemci bu tablolara yazamaz; firma yöneticileri yalnızca kendi firmasını `SELECT` eder.
Tüm `billing_*` RPC'leri yalnızca `service_role` çağırır ve `auth.uid() IS NOT NULL` ise reddeder.

## Davranış kuralları (yerel SQL testinde doğrulandı, üretimde değil)
- Başarılı tahsilat mevcut ödenmiş dönem sonundan uzar; çıkış-giriş gerekmez.
- Tutar/para birimi plan fiyatıyla uyuşmazsa reddedilir; başarısız/bekleyen ödeme erişim açmaz.
- Aynı bildirim/ödeme ikinci kez süre uzatmaz; niyet tek başına erişim vermez.
- İade: erişim hemen kapanır (**politika kararı**); askıdaki firma ödemeyle açılmaz.
- Süre bitince: görüntüleme/dışa aktarma açık, yazma sunucuda kapalı.

## iyzico (seçilen API: Checkout Form, tek seferlik)
| Konu | Kaynak (docs.iyzico.com) |
|---|---|
| Başlatma | `POST /payment/iyzipos/checkoutform/initialize/auth/ecom` (price, paidPrice, currency, callbackUrl, buyer, billingAddress, basketItems zorunlu) |
| Sonuç | `POST /payment/iyzipos/checkoutform/auth/ecom/detail` ({token}); `paymentStatus`, `paymentId`, `paidPrice`, `fraudStatus` (1=onaylı) |
| Kimlik doğrulama | `IYZWSv2`: HMAC-SHA256(randomKey + uri.path + body) |
| Webhook imzası | `X-IYZ-SIGNATURE-V3`: HMAC-SHA256(secretKey; secretKey+iyziEventType+iyziPaymentId+token+paymentConversationId+status); özellik entegrasyon@iyzico.com ile açılır |
| Yeniden deneme | 2xx dönmezse 15 dk arayla, 3 deneme |
| Sandbox adresi | Resmi sayfalarda **yalnızca canlı** adres (`api.iyzipay.com`) var; sandbox adresi iyzico panel/desteğinden doğrulanmalı. Kod `IYZICO_BASE_URL` olmadan çalışmaz (varsayılan yok) |

Gerçekten gereken sandbox bilgileri: **API key, secret key, sandbox base URL**. Merchant ID ve plan/ürün referans kodu **gerekmez**
(tek seferlik ödemede webhook imzası merchantId içermez; fiyat sunucudan gelir).
Canlıya geçişte ek olarak: fatura/vergi bilgisi alanları (buyer `identityNumber` zorunlu; firma vergi no/TCKN toplanmalı — açık iş).

## Mobil dağıtım modeli ve mağaza kuralları (resmi metinlerle)
Mobil paketlerde satın alma/WhatsApp yönlendirmeleri gizlenir; **bu tek başına uygunluğu kanıtlamaz.** Değerlendirme:

**Apple (App Review Guidelines):**
- 3.1.1: özellik/işlev kilidi açan abonelikler uygulama içi satın alma (IAP) ile olmalıdır.
- 3.1.3 giriş: IAP dışı yöntem kullanan uygulamalar, uygulama içinde başka satın alma yöntemini **teşvik edemez** (ABD mağazası ve 3.1.1(a)/3.1.3(a) hariç).
- 3.1.3(f) *Free Stand-alone Apps*: "Free apps acting as a stand-alone companion to a paid web based tool … do not need to use in-app purchase, provided there is no purchasing inside the app, or calls to action for purchase outside of the app."
- 3.1.3(c) *Enterprise Services*: yalnızca organizasyonlara/gruplara doğrudan satışta; "Consumer, single user, or family sales must use in-app purchase."
- Değerlendirme: PerdePRO'yu "ücretli web aracının ücretsiz yardımcı uygulaması" (3.1.3(f)) olarak sunmak mümkün görünüyor ve gizleme bu şartla uyumlu; **ancak** (1) uygulama içi 7 günlük deneme/kayıt ve (2) tek kişilik "solo" firmaların (3.1.3(c) kapsamı dışında) bulunması, inceleyicinin yorumuna bağlı risktir. Kesinlik için App Review'a önceden not/soru gönderilmeli. Uygulamanın kendisi "paid web tool'a eşlik eden yardımcı" olarak başvuruda açıkça tanımlanmalıdır.
- "Hesabınızı web'den yönetin" gibi yönlendirme metni, 3.1.3 girişindeki "uygulama içinde teşvik edemez" kuralı nedeniyle **doğrulanmadan eklenmedi**.

**Google Play:** abonelik ve uygulama işlevi satışı Play Billing gerektirir; istisnalardan biri "consumption-only apps" (uygulama içinde dijital ürün satmayan) — gizleme bu modelle uyumludur, ancak Google'ın güncel Payments politikası ve Türkiye için alternatif faturalandırma kuralları **doğrulanmadı**.

## Mağaza komisyonları (doğrudan resmi kaynaklar)
- **Apple abonelikleri** (developer.apple.com/app-store/subscriptions): ilk yıl geliştiriciye %70; bir aboneliğin ödemeli süresi **bir yılı aşınca %85**; **Small Business Program'da baştan %85** (yani komisyon %30 → %15; SBP %15). 
- Small Business Program sayfasında geçen "%10" ifadesi AB alternatif şartlarındaki geliştiriciler için bağlamda geçer; genel bir "1. yıldan sonra %10" kuralı **doğrulanamadı ve rapordan çıkarıldı**.
- **Google Play** (support.google.com/googleplay/android-developer/answer/112622): ABD, AEA, UK, Avustralya, Japonya dışındaki pazarlarda otomatik yenilenen aboneliklerde yıllık gelirden bağımsız düz %15. Türkiye bu listede yok → %15; güncel durum Play Console'dan teyit edilmeli.

## Açık kararlar / yapılacak iş
1. Test projesi + iyzico sandbox (anahtarlar kendi terminalinizde).
2. Plan fiyatları, KDV gösterimi, fatura/e-fatura (ayrı iş), buyer kimlik/vergi alanı.
3. Edge Function dağıtımı ve sandbox uçtan uca test (`scripts/staging/e2e-staging.mjs`).
4. Yenileme hatırlatma e-postası/bildirimi (tek seferlik modelde süre dolmadan).
5. Mobil mağaza stratejisi: 3.1.3(f) başvuru notu mu, IAP mi (Apple), Play Billing mi (Google) — iş kararı.
6. Android/iOS için gerçek IAP/Play Billing entegrasyonu ayrı bir iştir ve henüz **yoktur**.
