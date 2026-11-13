# PerdePRO 1.0.24

Solo paketinde sipariş oluştururken otomatik fatura nedeniyle oluşan paket yetkisi hatası giderildi. Muhasebe modülü kapalı olan firmalar sipariş ve tahsilat akışına devam edebilir.

Başarısız kayıt geri alma işlemlerinin sunucu sonucu doğrulanır. Tamamlanmamış kayıt varsa kimliği gösterilir ve aynı formdan mükerrer kayıt önlenir. Bulunamayan sipariş detayında anlaşılır uyarı gösterilir.

- Android: versionName 1.0.24, versionCode 24.
- iOS: marketing version 1.0.24, build 28.
- Windows: 1.0.24 kurulum paketi yayımlandı.

Mobil doğrulama iş akışı Android AAB/APK ve iOS Xcode arşivini **imzasız** üretir. Bu çıktılar mağaza yayını değildir ve müşteriye kurulum/güncelleme olarak gönderilmemelidir. Android için mevcut uygulamanın upload anahtarı; iOS için mevcut Apple Developer takımının dağıtım imzası ve App Store Connect erişimi kullanılmalıdır. Yeni bir Android imza kimliği üretilmemelidir.

Mağaza sürüm notu:

> Sipariş oluşturma akışı iyileştirildi. Solo pakette sipariş kaydını engelleyen hata giderildi; başarısız kayıt ve sipariş detay uyarıları düzenlendi.
