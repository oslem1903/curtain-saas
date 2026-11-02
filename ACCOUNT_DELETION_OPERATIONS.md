# Kalıcı hesap silme — işletim ve kurulum

Bu özellik **manuel kalıcı silme** süreci başlatır. Otomatik hesap/işletme silmez. Kullanıcıya 7 gün içinde tamamlanma süresi gösterir. Süper yönetici talepleri düzenli izleyip bu sürede gerçek veri temizliği ve Auth hesap silmesini yapmalıdır. Bu sorumluluk karşılanmadan canlıya almayın. Kullanıcıdan ayrıca telefon/e-posta/destek başvurusu istenmez. Apple onayı garanti edilmez.

## Kurulum

Supabase SQL Editor'da yalnız `supabase/migrations/20261029100000_account_deletion_requests.sql` dosyasını çalıştırın. Tarihsel migration'ları topluca çalıştırmayın. Mevcut hesap/işletme silinmez. Güncelleme politikası migration'ı ayrı ve varsayılan olarak kapalıdır.

Kullanıcı: Ayarlar / Hesap kurulumu / Kilit ekranı → Hesabımı sil. Doğrudan: `/#/account/delete`. Giriş ekranında takip bağlantısı vardır. Ekip üyesi ve salt okunur hesap da talep gönderebilir.
Yönetici: **Hesap Silme Talepleri** (`/#/super-admin/account-deletions`).

## Talebi tamamlama

1. Hedef UUID ve e-postayı Supabase Authentication hesabıyla eşleştirin. Talepte hedef kullanıcı sunucuda auth.uid() ile belirlenir. Kullanıcıdan ikinci bir başvuru istemeyin.
2. Tüm firma üyeliklerini/sahiplikleri inceleyin. Diğer çalışanların hesaplarını veya paylaşılan işletmeyi silmeyin. Tek sahip ayrılıyorsa işletme devamlılığı/yetki devrini güvenli biçimde ele alın.
3. Kişiye ait ilişkili kişisel verileri bulun: profil, üyelik, cihaz, davet, destek yüklemeleri, kişisel iletişim alanları, medya ve ilgili diğer kayıtlar. Şemadaki FK ve tetikleyicileri incelemeden toplu DELETE çalıştırmayın. Auth silme tek başına veri temizliği değildir.
4. Gerçek bir saklama yükümlülüğü olan kayıtları ve dayanağını belirleyin. Tüm iş verilerinin otomatik saklanabileceğini varsaymayın. Saklanması gerekmeyen kişisel verileri silin/anonimleştirin. Tamamlanma açıklamasına hangi veri türünün hangi gerekçeyle tutulduğunu yazın; e-posta/kimlik numarası/ad gibi verileri tekrar yazmayın.
5. Sahip olunan Storage dosyalarını Storage API/dashboard ile temizleyin. storage.objects tablosundan satır silmek gerçek dosyayı kaldırmaz. Ortak dosyaları yanlışlıkla silmeyin.
6. Gerekli veri temizliği ve sahiplik düzenlemesi bittikten sonra Auth hesabını kalıcı kaldırın; profil ve üyeliklerini temizleyin. Yalnız pasifleştirme veya soft-delete yeterli değildir.
7. Panelde **Silme işlemi sonrası onay** açın. Gerçekleşen temizliği ve varsa saklama kapsamını açıklayın. **KALICI SILINDI** onayıyla tamamlayın. Auth/profil/üyelik/Storage sahipliği varsa RPC reddeder. Diğer verilerin temizlendiği ve yasal saklama kapsamının doğruluğu operatör sorumluluğudur; otomatik ispatlanmaz.
8. Kullanıcı takip makbuzu/koduyla Auth hesabı kaldırıldıktan sonra da tamamlanma tarihi ve açıklamasını uygulamada görür. Tamamlanan talep satırından e-posta ve kullanıcı UUID'leri temizlenir. Bekleyen talepte hesap silindi denmez.

Hesap silme ayrı aboneliği/ödemeyi kendiliğinden iptal etmez. Gerçek abonelik durumunu kontrol edip geçerli süreci bildirin. Yeni IAP veya ödeme akışı eklenmedi.

## Güvenlik

Normal kullanıcı yalnız kendi talebini okur; doğrudan yazma yetkisi yoktur. Tekrarlı talepler aynı bekleyen başvuruyu döndürür. Tamamlama yalnız süper yönetici içindir; kendi başvurusunu tamamlayamaz. Anonim takip iki bağımsız rastgele UUID gerektirir; kimlik/şirket bilgisi döndürmez. Takip kodunu güvenli saklayın.

## Doğrulama sınırı

`ios-account-flow-smoke` Codemagic işi ayrı imzasız simülatör ve loopback sentetik backend kullanır. Kayıt, doğrulama ekranı, taklit doğrulama ile panel, silme talebi ve makbuz test edilir. Canlı hesap/e-posta/veri oluşturmaz veya silmez. ATS değişikliği yalnız bu atılacak simülatör checkout'undadır. Gerçek SMTP ve canlı SQL kurulumu test kapsamında değildir.

SQL güvenlik testi `tests/sql/account_deletion/check.mjs`, izole PGlite/PostgreSQL üzerinde çalışır. Canlıda bir kontrollü talep ve operatör tamamlaması doğrulanmadan uçtan uca canlı test geçti denmemelidir.
