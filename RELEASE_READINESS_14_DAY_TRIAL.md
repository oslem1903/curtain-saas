> **GUNCEL KARAR (2026-10-11):** Deneme suresi **7 gundur**. Bu belgedeki 14 gunluk deneme ve migration 028 ifadeleri gecersizdir (028 `supabase_superseded/` altina tasindi; uretimde `trial_days` zaten 7). Migration 029 uygulanmamalidir (okumayi da kapatir); sure bitince goruntuleme ve disa aktarma acik, yazma sunucuda kapali kalir.

# PerdePRO 14 Günlük Deneme ve Mağaza Hazırlığı

Bu dosya yerel kod değişikliklerinin yayın öncesi operasyon adımlarını içerir. Canlı migration, web deploy, App Store Connect veya Google Play Console üzerinde işlem yapılmadı.

## Bu Oturumdaki Erişim Bulguları

- Yerel link guard `npm run check:link` başarılı: uygulama ref'i ve `supabase/.temp` ref'i `ffhmzlcsgsgjonqqhgqq`; linked-project metadata adı `perdepro`.
- `supabase/config.toml` yok. `npx supabase projects list` ile geçerli CLI hesabında PerdePRO ref'i görünmedi; CLI listesinde yalnızca üç başka proje vardı.
- `npx supabase db query --linked` salt okunur test sorgusu HTTP 403 `necessary privileges` ile reddedildi. Yerel `supabase/.temp/pooler-url` dosyasında parola yok; doğrudan bağlantı `no password supplied` ile başarısız oldu. Bu yüzden precheck/diagnostic SQL çalıştırılmadı.
- En kısa DB unblock: makinede `npx supabase login` ile PerdePRO projesinde SQL/DB erişimi olan proje sahibi hesabıyla oturum açın (token/şifreyi sohbete değil, yalnızca yerel terminal/browser prompt'una girin). `npx supabase projects list` içinde `perdepro / ffhmzlcsgsgjonqqhgqq` görünmeli ve `npx supabase db query --linked "select current_database()"` çalışmalı. Hâlâ 403 ise proje sahibinden bu CLI hesabına gerekli database query/migration yetkisini verin.
- `VITE_PUBLIC_APP_URL` bulunmuyor. Git remote GitHub deposu; `.github/workflows` ve web deploy script'i yok. [Codemagic config](codemagic.yaml) yalnızca iOS archive/IPA akışlarını içeriyor. Web yayınını yapabilmek için mevcut hosting/domain ve ona deploy yetkisi gerekli; yeni hosting varsayılmadı.

## Kayıt Bağlantısı

Uygulama rotası `/#/signup` şeklindedir. Reklamda kullanılacak adres, üretim web alan adı yayınlandıktan sonra `https://<üretim-alanı>/#/signup` olmalıdır. Bu workspace'te doğrulanmış bir üretim web alan adı veya mevcut Instagram kayıt sayfası bulunmadığı için dışarıdan erişilebilir kayıt bağlantısı henüz verilemez.

## Supabase Önkoşulları

1. Üretim domainini Supabase Auth **Site URL** olarak ayarlayın.
2. **Redirect URLs** allowlist'ine üretim web callback'ini (`https://<üretim-alanı>/**`) ve `com.curtainsaas.app://auth/callback` adresini ekleyin. Aynı deep link signup doğrulama ve parola kurtarma callback'inde kullanılır.
3. E-posta signup doğrulamasını açık tutun ve SMTP/confirmation template teslimatını kontrol edin. Supabase'in `redirect_to` değerinin `emailRedirectTo` bilgisini koruduğunu doğrulayın.
4. `VITE_PUBLIC_APP_URL` değerini üretim web adresiyle derleme ortamında tanımlayın. Native Android/iOS dönüşü özel URL scheme'i kullanır; Electron için web URL gerekir.
5. Önce salt okunur precheck'leri inceleyin. Eksik migration'ları 024 → 025 → 026 → 027 → 028 → 029 → 030 sırasıyla, SQL Editor'da yetkili operatör olarak uygulayın. 023 de cihaz/RPC bağımlılıkları eksikse ilgili precheck ve release planına göre önce uygulanmalıdır. Her migration'dan sonra ilgili `*_verify_readonly.sql` dosyasını çalıştırın.
6. 028 mevcut global self-signup ayarını 14 güne geçirir; önceki değeri rollback için saklar. Var olan `companies` ve `trial_grants` tarihlerini değiştirmez.
7. 029 tüm listelenen `company_id` iş tablolarında restrictive RLS policy kurar. RLS kapalı veya beklenmedik şemalı tablo görürse durur. 029 precheck'teki tüm `company_id` tablo listesini ve Storage politikalarını ayrıca inceleyin.
8. Geri alma gerekiyorsa önce 030, sonra 029, sonra 028 rollback dosyalarını değerlendirin. 029 rollback süresi dolmuş kullanıcılara mevcut permissive RLS kurallarıyla yeniden okuma erişimi açabilir.

## Hülya ve İnceleme Hesabı Tanısı

`supabase_migration_031_problem_account_diagnostics_readonly.sql` yetkili SQL Editor'da salt okunur çalıştırılır. Hülya isim eşleşmelerinin tamamını Auth ID ile listeler; aynı isimli hesap seçmez. Apple e-postasında doğrulama, profil, gerçek üyelikler, firma erişim durumu ve yalnızca verilen kodla eşleşen davet kaydı raporlanır. Parola, davet token'ı ve tam davet kodu raporlanmaz.

Sonuca göre mevcut Auth ID ve gerçek `company_members` kaydı doğrulanmadan hiçbir hesap birleştirilmemeli veya taşınmamalıdır. Kullanılmış davet yeniden açılmaz. E-posta doğrulanmış ve doğru davete ait mevcut hesap, migration 027'nin idempotent kabul RPC'siyle tamamlanır. Üyeliği kayıp kullanılmış davet, mevcut hesapla çözülemiyorsa yeni davet gerektirir. Parola sıfırlama bağlantısı `/reset-password` rotasına dönmelidir.

Test notu: İlk duplicate-email Playwright denemesinde dar URL interceptor'ı Auth isteğini yakalamadı; ekran doğrulama e-postası gönderildiğini gösterdi. `existing@example.test` adresiyle bir Auth kullanıcısı oluşmuş olabilir. Proje Auth kayıtlarına yönetici erişimi olmadığı için varlığı doğrulanamadı; hiçbir kullanıcı silinmedi. Yetkili operatör `supabase_migration_031_problem_account_diagnostics_readonly.sql` ile bu adresi kontrol etmelidir. Sonraki tekrar, tüm uzak trafiği kapatan mock ile geçti.

## Apple İnceleme Hesabı

1. Ayrı, örnek verili bir inceleme firması oluşturun. Denetim amacı için Solo modül kapsamı korunabilir; tüm mevcut özelliklerin incelemesi isteniyorsa gerekli modülleri açıkça etkinleştirin.
2. Supabase Auth yönetim ekranında ayrı bir inceleme kullanıcısı oluşturun ve e-postasını doğrulanmış işaretleyin. Uygulama rolü yalnızca `admin` olsun; `super_admin` vermeyin.
3. Firma düzenleme ekranında auth hesabını e-postayla bulun ve `Yönetici` rolüyle bağlayın. Bu hesap yalnızca inceleme firmasına özel ise başka üyelik onayına gerek yoktur.
4. Süper Admin → Süre / Özel Erişim üzerinden `is_pilot=true`, bitiş tarihi boş (süresiz) ve açıklama olarak Apple inceleme amacı verin. Böylece inceleme beklerken deneme dolmaz.
5. Örnek müşteri, ölçü, teklif ve sipariş ekleyip gerçek kullanıcı hesabıyla test edin. Giriş e-postası/şifresini yalnızca App Store Connect'in güvenli inceleme alanına yazın; kaynak koda, migration'a veya loglara koymayın.
6. App Store Connect'te inceleme notuna uygulamayı açma, e-posta/şifre ile giriş ve örnek firmada modüllere erişim adımlarını ekleyin. Hesap hazır ve gerçek cihazda doğrulanmadan Apple yanıtı göndermeyin.

### Apple'a Yanıt Taslağı

Bu taslağı yalnızca Apple inceleme hesabı oluşturulup gerçek iOS cihazında doğrulandıktan sonra gönderin.

> İnceleme geri bildiriminiz için teşekkür ederiz. Giriş ve e-posta doğrulama akışını güncelledik; inceleme hesabı artık davet kodu veya süresi dolan denemeye bağlı değildir. Lütfen ekli inceleme adımlarındaki hesapla giriş yapın. İncelenen sürüm: **[App Store sürümü/build]**. Değişikliği **[cihaz ve iOS sürümü]** üzerinde doğruladık. **[Yalnızca gerçekten test edildiyse ekleyin.]**

## Google Play Kapalı Test

- Play Console kapalı testine en az 12 Google hesabı davet edin; katılımcıların opt-in bağlantısını açıp teste katıldığını doğrulayın.
- Testi kesintisiz en az 14 gün sürdürün. Uygulamadaki signup Play testine katılım sayılmaz; uygulamada 12 kullanıcı üst sınırı yoktur.
- Katılımcıların uygulama trial'ı test dönemi bitmeden dolacaksa, super-admin süre uzatma RPC'siyle açık gerekçe (`Google Play closed test`) girerek gereken süreyi verin. Bu ayar denemenin global varsayılanını değiştirmez.
- Mevcut Instagram reklam/kayıt sayfası bu workspace'te bulunamadı. Varsa sayfada Google hesabı ve Play opt-in adımını ayrı gösterin; yeni pazarlama sitesi açmayın. Play test URL'si Console'dan alınır ve yalnızca onaylı tester'larla paylaşılır.

## Yerel Uygulama Sürümü

Web kaynak değişikliklerini dağıtım öncesi `npm run build` ve Capacitor sync ile Android/iOS public assets'e kopyalayın. Android yapılandırması `1.0.12 / versionCode 13`, iOS yapılandırması `1.0.12 / build 13` olarak eşlenmiştir. Android signing, cihaz login'i ve iOS cihaz/Xcode doğrulaması ayrı yayın kapılarıdır; bu dosya bunların tamamlandığını iddia etmez.