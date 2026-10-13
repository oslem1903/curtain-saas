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
| Web production (`oslem1903-curtain-saas`) | Canlı, commit `6b44acb`; 118 JS parçası yerel derlemeyle bayt bayt aynı, `app.perdepro.com` yok |
| Google Play **dahili test** | **Yayında**: sürüm adı 1.0.14, **kod 17** (16'dan sonraki; 16'da yanlış alan adı yedeği vardı). Kaynak commit `799f1f6` |
| TestFlight build 16 | Codemagic #15: yüklendi, işlendi, Beta App Review gönderimi `WAITING_FOR_REVIEW` (App Store Connect'te oturum açık değil, durum Codemagic günlüğünden) |
| TestFlight build 17 | Codemagic #16 (`799f1f6`) başlatıldı; sonuç bu belgede ayrıca kaydedilir |
| Herkese açık mağaza (Play üretim / App Store) | **Gönderilmedi** (bilerek) |
| Fiziksel cihaz testi | **Yapılmadı** (cihaz/emülatör yok) |

## Alan adı
- `perdepro.com` kullanıcıya ait DEĞİL; `app.perdepro.com` bağlantısı Vercel'den kaldırıldı ve Supabase yönlendirme
  izin listesinden silindi. Yeni alan adı eklenmedi/satın alınmadı.
- Çalışan adres: `https://oslem1903-curtain-saas.vercel.app` (Supabase Site URL bu adrestir).
- Supabase yönlendirme izin listesi: yerel geliştirme adresleri, `https://oslem1903-curtain-saas.vercel.app/#/reset-password`,
  `https://oslem1903-curtain-saas.vercel.app/#/auth/callback` ve mobil derin bağlantı `com.curtainsaas.app://**`.
