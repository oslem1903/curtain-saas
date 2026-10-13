# PerdePRO 1.0.14 — Sürüm notları ve mağaza paketi

| | Android | iOS |
|---|---|---|
| Paket / Bundle ID | `com.curtainsaas.app` | `com.curtainsaas.app` |
| Sürüm adı | 1.0.14 | 1.0.14 (`MARKETING_VERSION`) |
| Sürüm kodu / build | **16** (`versionCode`) | **16** (`CURRENT_PROJECT_VERSION`) |
| Önceki mağaza durumu | Play dahili test: 1.0.11 (kod 11) | TestFlight: 1.0.5 (build 1–3, Codemagic #11–#14) |
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
