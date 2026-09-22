# PerdePRO — iOS Derleme ve Yayın Rehberi

Bu proje Capacitor 8 ile Android/Windows/Web yanında **iOS** hedefini de destekler.
`ios/` klasörü Capacitor tarafından üretilmiş gerçek bir Xcode projesidir
(SPM tabanlı — CocoaPods/Podfile **gerekmez**).

---

## 1. Ön koşul: Mac zorunlu

Windows'ta yapılabilenlerin tamamı bu depoda **yapıldı** (aşağıya bak).
Ancak `.ipa` üretmek, simülatörde çalıştırmak ve App Store'a yüklemek için
Apple'ın kuralı gereği **macOS + Xcode** şarttır. Windows'tan iOS derlenemez.

Seçenekler:

| Yol | Ne gerekir | Not |
|---|---|---|
| Kendi Mac'iniz | Mac mini / MacBook + Xcode 15+ | En ucuz uzun vadeli yol |
| Kiralık bulut Mac | MacStadium, MacinCloud (~$25–70/ay) | Uzak masaüstüyle Xcode |
| CI ile derleme | GitHub Actions `macos-latest` runner, Codemagic, Bitrise | Makine almadan `.ipa` üretir |

Her durumda **Apple Developer Program üyeliği (yıllık 99 USD)** gerekir —
TestFlight ve App Store dağıtımı bunsuz olmaz.

---

## 2. Bu depoda hazır olanlar

- `ios/` Xcode projesi ve 8 Capacitor eklentisi (kamera, dosya, klavye,
  yerel bildirim, paylaşım, splash, durum çubuğu, app)
- `Info.plist`:
  - Uygulama adı **PerdePRO**
  - Kamera / fotoğraf arşivi / **mikrofon** izin açıklamaları (Türkçe)
  - `arm64` cihaz gereksinimi, dikey yönlendirme
  - `ITSAppUsesNonExemptEncryption = false` (şifreleme beyanı sorulmaz)
- Uygulama ikonu: 1024×1024, **alfa kanalsız** (App Store şartı)
- Açılış ekranı (splash): PerdePRO logosu
- Sürüm numarası `package.json` ile eşitlendi (`MARKETING_VERSION = 1.0.4`)
- Durum çubuğu ve klavye stili sistem temasına (açık/koyu) göre çalışır
- Güncelleme bildirimi iOS'ta linki uygulama içinde değil, **sistem
  tarayıcısında** açar (App Store linki için gerekli)

---

## 3. Adım adım derleme (Mac'te)

```bash
git clone <repo> && cd curtain-saas
npm install
npm run cap:sync-ios     # web build + ios'a kopyala
npx cap open ios         # Xcode açılır
```

Xcode'da:

1. Sol panelde **App** hedefi → **Signing & Capabilities**
   - "Automatically manage signing" işaretli
   - **Team**: Apple Developer hesabınız
   - **Bundle Identifier**: `com.curtainsaas.app`
     (Apple Developer portalında bu ID'yi bir kez kaydedin)
2. Üstten hedef cihaz seçin (simülatör veya bağlı iPhone) → **⌘R**
3. Yayın için: **Product → Archive** → **Distribute App** → **App Store Connect**

Sürüm yükseltirken `package.json` `version` alanını değiştirin, sonra
Xcode'da `MARKETING_VERSION` (görünen sürüm) ve `CURRENT_PROJECT_VERSION`
(build numarası — her yüklemede artmalı) alanlarını güncelleyin.

---

## 4. App Store Connect için hazırlık

- Uygulama adı, açıklama, anahtar kelimeler (Türkçe)
- **Ekran görüntüleri**: 6.7" iPhone ve 5.5" iPhone zorunlu
- **Gizlilik politikası URL'si** — zorunlu
- **Veri toplama beyanı (Privacy Nutrition Labels)**: uygulama Supabase'e
  e-posta, ad, telefon, müşteri kayıtları ve fotoğraf gönderiyor; bunları
  "Contact Info / User Content / Identifiers" başlıklarında beyan edin
- **İnceleme için demo hesap**: App Store ekibi giriş yapamazsa reddeder.
  Notlar alanına çalışan bir test firması e-postası + şifresi bırakın.
- Uygulama davet kodu ile kayıt akışı kullandığı için, demo hesabın
  deneme süresi (`trial_ends_at`) inceleme boyunca dolu olmamalı.

---

## 5. Cihazda mutlaka test edilecekler

Aşağıdakiler kod incelemesiyle doğrulandı ama gerçek cihaz testi ister:

- [ ] **Çentikli ekranlar** (iPhone 14/15/16): alt gezinme çubuğu ve sabit
      alt butonlar home-indicator'ın altında kalmamalı.
      Sorun görülürse `capacitor.config.ts` içindeki
      `ios.contentInset: 'automatic'` değerini `'never'` yapıp tekrar deneyin —
      çift güvenli-alan boşluğunun en olası kaynağı budur.
- [ ] **Sesli not** (Saha Bilgileri): mikrofon izni sorulmalı, kayıt `.mp4`
      olarak yüklenmeli. `NSMicrophoneUsageDescription` eklenmeseydi iOS
      uygulamayı anında kapatıyordu — bu düzeltildi.
- [ ] **Fotoğraf çekimi / galeriden seçme** (ölçü, kartela, montaj)
- [ ] **Belge yazdırma**: iOS WebView'de `window.print()` yoktur; uygulama
      belgeyi HTML dosyası olarak **paylaşım sayfasına** verir. Oradan
      "Yazdır" veya "Dosyalara Kaydet" seçilir. Beklenen davranış budur.
- [ ] **QR / barkod okuma**: `BarcodeDetector` API'si iOS Safari/WKWebView'de
      **yoktur**. Uygulama "bu cihaz desteklemiyor, kodu elle girin" uyarısı
      verir. iOS'ta gerçek tarama isteniyorsa
      `@capacitor-mlkit/barcode-scanning` eklentisi eklenmelidir — ayrı iş.
- [ ] **Yerel bildirimler**: randevu/montaj hatırlatmaları
- [ ] **Klavye**: form alanına odaklanınca alan klavyenin altında kalmamalı
- [ ] **Koyu tema**: iOS ayarlarından koyu temaya geçince durum çubuğu yazısı
      okunabilir kalmalı

---

## 6. Faydalı komutlar

```bash
npm run cap:sync-ios    # build + ios'a senkronize (Windows'ta da çalışır)
npm run cap:open-ios    # Xcode'u açar (yalnızca Mac)
npx cap run ios         # simülatörde çalıştırır (yalnızca Mac)
```

`npx cap sync ios` Windows'ta da sorunsuz çalışır; web varlıklarını ve
eklenti listesini günceller. Yani kod geliştirmeye Windows'ta devam edip
yalnızca derleme anında Mac'e geçebilirsiniz.
