# PerdePRO 1.0.14 — Sürüm notları ve mağaza paketi

| | Android | iOS |
|---|---|---|
| Paket / Bundle ID | `com.curtainsaas.app` | `com.curtainsaas.app` |
| Sürüm adı | 1.0.14 | 1.0.14 (`MARKETING_VERSION`) |
| Sürüm kodu / build | **17** (`versionCode`) | **17** (`CURRENT_PROJECT_VERSION`) |
| Önceki mağaza durumu | Play dahili test: 1.0.14 (kod 16, yanlış alan adı yedeği içerir) | TestFlight: 1.0.14 (build 16, aynı) |
| Kaynak | `release/1.0.14-access-trial7` | aynı dal, Codemagic `perdepro-ios` iş akışı |

## Mağaza açıklaması (Türkçe, "Yenilikler")
- Deneme/abonelik süresi bittiğinde verilerinizi görüntüleyebilir ve Excel yedeği olarak dışa aktarabilirsiniz;
  yeni kayıt, düzenleme ve silme işlemleri lisans alınana kadar kapalıdır. Verileriniz silinmez.
- Süre bitince de destek talebi açabilir ve ekran görüntüsü ekleyebilirsiniz; ek, talebinize bağlanır
  ve "Ayarlar > Destek Taleplerim" listesinden açılır.
- Fotoğraflar artık firmanıza özel, kısa süreli güvenli adreslerle gösterilir.
- Tedarikçi cari ekstresi, PDF/yazdırma ve mobil sekme şeritleri düzeltmeleri.
- Genel kararlılık ve güvenlik iyileştirmeleri.

## Uygulama içi sürüm notu (kısa)
"Süre bitiminde görüntüleme/dışa aktarma açık kalır. Destek talebine ek bağlama düzeltildi. Güvenlik ve kararlılık iyileştirmeleri."

## App Review / Google inceleme notları
- Giriş: e-posta + parola. İnceleme hesabı bilgileri App Store Connect "App Review Information" alanında tutulur; bu belgede yer almaz.
- Deneme süresi bittiğinde uygulama salt-okunur moda geçer. Uygulama içinde ödeme/dijital ürün satın alma yoktur; lisans için satış/destek ile iletişim yönlendirmesi gösterilir.
- Hesap silme/gizlilik: uygulama içi Ayarlar ve destek talebi üzerinden.

## Sürümde bulunan düzeltmelerin kaynağı
Web 1.0.14 (production, commit `6d9ad37`) ile aynı kod tabanı: salt-okunur istemci koruması (`readOnlyGuard`),
destek ekini talebe bağlayan RPC, onboarding sihirbazının salt-okunur hesapta açılmaması.

## Yayın durumu (2026-10-13)

| Hedef | Durum |
|---|---|
| Web production (`oslem1903-curtain-saas`) | Canlı, commit `6d9ad37`; mobil paketler aynı web kodunu içerir |
| Google Play **dahili test** | **Yayında**: sürüm adı 1.0.14, **kod 16** (önceki: 1.0.11 / kod 11). AAB SHA-256 `b39615d9da1218df6b8f0a603ebe3a4c11aee3db1ffe4466826cda7857c4de6f`; kaynak commit `a895dd3` |
| TestFlight | Codemagic **#15** (`perdepro-ios`, dal `release/1.0.14-access-trial7`, commit `a895dd3`) **bitti**: sürüm 1.0.14, build 16 App Store Connect'e yüklendi, işleme tamamlandı, TestFlight beta incelemesine gönderildi |
| Herkese açık mağaza (Play üretim / App Store) | **Gönderilmedi** (bilerek) |

## Alan adı
- `perdepro.com` kullanıcıya ait DEĞİL; `app.perdepro.com` bağlantısı Vercel'den kaldırıldı ve Supabase yönlendirme
  izin listesinden silindi. Yeni alan adı eklenmedi/satın alınmadı.
- Çalışan adres: `https://oslem1903-curtain-saas.vercel.app` (Supabase Site URL bu adrestir).
- Supabase yönlendirme izin listesi: yerel geliştirme adresleri, `https://oslem1903-curtain-saas.vercel.app/#/reset-password`,
  `https://oslem1903-curtain-saas.vercel.app/#/auth/callback` ve mobil derin bağlantı `com.curtainsaas.app://**`.
