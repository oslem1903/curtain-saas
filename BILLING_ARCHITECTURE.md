# PerdePRO Abonelik / Ödeme Mimarisi (TASLAK)

Durum: **tasarım + yerel test edilmiş taslak şema.** Üretime uygulanmadı, hiçbir sağlayıcı hesabı açılmadı,
canlı/sandbox ödeme akışı **test edilmedi** (sağlayıcı hesabı ve Edge Function'lar yok).

## Bugünkü durum (kanıtlı)
- Uygulama içi "Satın Al" bir WhatsApp bağlantısıdır; lisansı süper admin elle açar (`payment_reference`).
- Ödeme sağlayıcısı, webhook, Edge Function, abonelik/ödeme tablosu **yoktur**.
- Sunucuda yazma kilidi çalışır: `company_subscription_allows_write()` + `trg_subscription_write_guard` +
  `protect_license_fields` (kullanıcı kendi lisansını/özel erişimini değiştiremez).

## Tek gerçek kaynağı
Tüm kanallar aynı firma kaydını günceller: `companies.plan_status`, `license_expires_at`, `package_code`.
Erişim kararı bugünkü sunucu fonksiyonundadır; istemci saatine bakılmaz.

```
 iyzico/PayTR webhook ─┐
 Google Play RTDN ─────┼─> Edge Function (service_role) ─> doğrula ─> billing_apply_* RPC ─> companies
 App Store Server Notif.┘        (imza + sağlayıcıdan geri sorgu)        (idempotent)
```

## Tablolar (taslak: `supabase_migration_032_billing_core_DRAFT.sql`)
| Tablo | Amaç |
|---|---|
| `billing_plans` | Plan kodu, dönem (ay/yıl), fiyat, para birimi, paket (`solo` …) |
| `billing_subscriptions` | Firma başına **tek canlı** abonelik (kısmi benzersiz indeks); kanal, sağlayıcı referansı, dönem sonu, iptal bayrağı |
| `billing_events` | Ham bildirim + `UNIQUE(channel, provider_event_id)` → mükerrer bildirim engeli, sonuç (`applied`, `duplicate`, `rejected_*`) |
| `billing_payments` | Tahsilat/iade satırları, `UNIQUE(channel, provider_payment_id, kind)` |

İstemci (anon/authenticated) bu tablolara **yazamaz**; firma yöneticileri yalnızca kendi firmasını `SELECT` eder.
`billing_apply_charge/…refund/…cancel/…failure` yalnızca `service_role` çağırabilir ve `auth.uid() IS NOT NULL` ise reddeder.

## Davranış kuralları (yerel testte doğrulandı)
- Başarılı tahsilat: erişim, mevcut ödenmiş dönem sonundan (yoksa şimdiden) 1 ay/1 yıl uzar; çıkış-giriş gerekmez.
- Tutar/para birimi plan fiyatıyla uyuşmazsa reddedilir, erişim açılmaz.
- Başarısız/bekleyen/iptal edilen ödeme erişim açmaz.
- Aynı bildirim veya aynı ödeme ikinci kez süre uzatmaz.
- İptal: dönem sonuna kadar erişim sürer. İade: erişim hemen kapanır (**politika kararı**, değiştirilebilir).
- Askıya alınmış firma ödemeyle yeniden açılmaz.
- Farklı kanaldan gelen ödeme aynı firmanın tek aboneliğine yazılır.
- Süre bitince: görüntüleme/dışa aktarma açık, yazma sunucuda kapalı (mevcut davranış).

## Kanal bazlı sunucu doğrulaması (Edge Function sorumlulukları)
| Kanal | Doğrulama |
|---|---|
| iyzico | `X-IYZ-SIGNATURE-V3` (HMAC-SHA256); abonelik olayları `subscription.order.success/failure`; ayrıca `subscription retrieve` ile geri sorgu |
| PayTR | `hash = base64(HMAC_SHA256(merchant_oid + merchant_salt + status + total_amount, merchant_key))`; yanıt düz `OK`; yinelenen bildirim yalnızca ilkine işlenir |
| Google Play | RTDN (Pub/Sub) bildirimi → Android Publisher API `subscriptionsv2.get` ile sunucuda token doğrulama |
| App Store | App Store Server Notifications V2 (JWS imza doğrulama) + App Store Server API ile işlem sorgusu |

Hiçbir kanalda istemciden gelen "ödeme başarılı" bilgisine güvenilmez; başarı sayfası yalnızca durum okur.

## Açık kararlar / yapılacak iş
1. Web sağlayıcısı seçimi ve hesap/sözleşme (kullanıcı kararı).
2. Plan fiyatları ve yıllık indirim; KDV gösterimi; fatura (e-fatura entegrasyonu ayrı iş).
3. Edge Function'lar: checkout oturumu oluşturma, webhook alıcıları, geri sorgu.
4. UI: Plan seçimi, aylık/yıllık, ödeme durumu, iptal; iOS'ta Apple kurallarına uygun akış.
5. Sandbox uçtan uca testleri: başarılı/başarısız ödeme, 7 gün bitiş kilidi, ödeme sonrası erişim.
6. Süre dolum yenileme/dunning politikası ve bildirim e-postaları.
