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

## Yayın durumu (2026-10-13)

| Hedef | Durum |
|---|---|
| Web production (`oslem1903-curtain-saas`) | Canlı, commit `6d9ad37`; mobil paketler aynı web kodunu içerir |
| Google Play **dahili test** | **Yayında**: sürüm adı 1.0.14, **kod 16** (önceki: 1.0.11 / kod 11). AAB SHA-256 `b39615d9da1218df6b8f0a603ebe3a4c11aee3db1ffe4466826cda7857c4de6f`; kaynak commit `a895dd3` |
| TestFlight | Codemagic **#15** (`perdepro-ios`, dal `release/1.0.14-access-trial7`, commit `a895dd3`, build 16) **kuyrukta** — Codemagic platformu "Degraded" |
| Herkese açık mağaza (Play üretim / App Store) | **Gönderilmedi** (bilerek) |

## app.perdepro.com (domain)
- Vercel projesine eklendi (`oslem1903-curtain-saas`), doğrulama bekliyor.
- DNS `natrohost.com` (Natro) üzerinde; Vercel'de DNS yönetimi yok. Eklenmesi gereken tek kayıt:

  | Tür | Ad / Host | Değer | TTL |
  |---|---|---|---|
  | CNAME | `app` | `0aea56e7d0fe0ab2.vercel-dns-017.com.` | 3600 (veya varsayılan) |

  (`cname.vercel-dns.com.` de kabul edilir.) Mevcut A / MX / TXT kayıtlarına dokunmayın; yalnızca `app` alt alanı eklenir.
- Kayıt yayılınca Vercel HTTPS sertifikasını otomatik üretir. Sonrasında Supabase **Site URL**'i
  `https://app.perdepro.com` yapın (yönlendirme izin listesine `https://app.perdepro.com/**` ve
  `com.curtainsaas.app://**` zaten eklendi; geçersiz token ile doğrulandı).
