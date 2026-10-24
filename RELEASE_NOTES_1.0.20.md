# PerdePRO 1.0.20 — Sürüm notları ve mağaza paketi

| | Android | iOS |
|---|---|---|
| Paket / Bundle ID | `com.curtainsaas.app` | `com.curtainsaas.app` |
| Sürüm adı | 1.0.20 | 1.0.20 (`MARKETING_VERSION`) |
| Sürüm kodu / build | **21** (`versionCode`) | **18** (`CURRENT_PROJECT_VERSION`) |
| Önceki | Play dahili test: 1.0.19 (kod 20) | App Store Connect: 1.0.14 (build 17, inceleme gönderilmişti) |
| Kaynak | `release/1.0.14-access-trial7` | aynı dal, Codemagic `perdepro-ios` iş akışı |

## Mağaza açıklaması (Türkçe, "Yenilikler")
- **Ekip kullanıcıları:** Firma sahibi artık ekibini e-posta ile davet edebilir ve her kullanıcının hangi bölümleri
  göreceğini seçebilir. Davet edilen kişi e-postadaki bağlantıdan şifresini belirler ve yalnızca sizin yazdığınız
  e-posta ile katılabilir. Solo pakette siz dahil 4 kullanıcı.
- Ekip üyeleri ayarlar, abonelik ve kullanıcı yönetimi ekranlarını göremez; yaptıkları tüm işlemler firmanızın
  verisine kaydolur.
- Giriş ekranından "davet kodu" ile katılım kaldırıldı; davetler artık e-posta bağlantısıyla gelir.
- Silme işlemlerinde doğrulama, kâr kartı ve montaj ekranı düzeltmeleri; genel kararlılık iyileştirmeleri.

## Uygulama içi sürüm notu (kısa)
"Ekibinizi e-posta ile davet edin, kullanıcı başına bölüm yetkisi verin. Güvenlik ve kararlılık iyileştirmeleri."

## App Review / Google inceleme notları
- Giriş: e-posta + parola. İnceleme hesabı bilgileri App Store Connect "App Review Information" alanında tutulur; bu belgede yer almaz.
- Deneme süresi bittiğinde uygulama salt-okunur moda geçer. Uygulama içinde ödeme/dijital ürün satın alma yoktur.
- Yeni özellik: firma yöneticisi menüsünde "Kullanıcılar" (e-posta ile davet). Davet e-postası Supabase Auth ile gider,
  uygulama içinde başka bir kayıt/ödeme akışı eklenmedi.

## Zorunlu güncelleme sırası (önemli)
`app_updates` kaydı platform ayırmaz; yeni sürümden eski sürümü kullananlara engelleyici pencere gösterilir.
Kaydı **yalnızca iki mağaza da 1.0.20'yi yayınladıktan sonra** (Play üretim + App Store) yazın; aksi halde yayında olmayan
platformun kullanıcıları güncelleme bulamaz. Windows için ayrı indirme adresi gerekir.

## Doğrulama (2026-10-24)
- Web production: `index-zm_61vNu.js` (Vercel `oslem1903-curtain-saas`); AAB içindeki paket aynı dosyayı içerir.
- Android AAB: imzalı (release anahtarı, SHA-256 `4B:FB:8A:66:...:E7:2F:D3`), sürüm kodu 21 / adı 1.0.20.
- Fiziksel cihaz testi **yapılmadı**.
- iOS: Windows'ta derlenemez; Codemagic `perdepro-ios` ile derlenip App Store Connect'te gönderilir.
