# PerdePRO — Rol Bazlı Manuel Test Planı (pilot öncesi)

Bu plan, **üretim veritabanına yazan otomatik E2E testleri çalıştırılmadan**
elle yürütülecek şekilde hazırlandı. Her adımın yanına ✅ / ❌ ve gözlemi yazın.

**Kural:** Bir adım ❌ ise pilot başlatmayın; adım numarasını bildirin.

---

## 0. Hazırlık

| | |
|---|---|
| Sürüm | 1.0.4.1 |
| Supabase projesi | `ffhmzlcsgsgjonqqhgqq` |
| Test edilecek istemciler | Windows kurulumu (EXE), Android (APK), tarayıcı |

> ⚠️ `supabase/.temp/project-ref` dosyası **farklı** bir projeye (`egvclvmsmyvbqfuzchvz`)
> işaret ediyor. Supabase CLI ile migration çalıştırmadan önce `supabase link`
> komutunu doğru projeye yeniden çalıştırın — aksi halde yanlış veritabanına yazarsınız.

Her rol için ayrı bir tarayıcı profili / gizli pencere kullanın ki oturumlar karışmasın.

---

## 1. Süper Admin

| # | Adım | Beklenen | Sonuç |
|---|------|----------|-------|
| 1.1 | Süper admin hesabıyla giriş | Süper Admin menüsü açılır | |
| 1.2 | Firmalar listesi | **Tüm** firmalar görünür | |
| 1.3 | Yeni firma oluştur (test adı: `ZZ-TEST-<tarih>`) | Firma listeye düşer, deneme süresi atanır | |
| 1.4 | Firma düzenle: paket değiştir | Değişiklik kaydedilir | |
| 1.5 | Modül aç/kapat | İlgili firmada menü değişir | |
| 1.6 | Deneme süresi uzat | `trial_ends_at` güncellenir, banner yeni tarihi gösterir | |
| 1.7 | Lisans durumunu "expired" yap | O firmanın kullanıcısı `/locked` ekranına düşer | |
| 1.8 | Kullanıcı/davet yönetimi: davet oluştur | Davet kodu/e-postası üretilir | |
| 1.9 | Firma detay sekmeleri (telefonda) | Tüm sekmeler yatay kaydırılarak erişilebilir | |

## 2. Admin (firma yöneticisi)

| # | Adım | Beklenen | Sonuç |
|---|------|----------|-------|
| 2.1 | Giriş | Dashboard açılır | |
| 2.2 | Dashboard rakamları | Tahsilat / gider / kasa / yaklaşan tahsilat, Muhasebe ekranıyla **aynı** | |
| 2.3 | Ölçü Al: fotoğraf çek + not + renk/model gir | Kaydedilir, fotoğraf görünür | |
| 2.4 | Ölçüden sipariş oluştur | Fotoğraf **ve** not siparişe aktarılır | |
| 2.5 | Siparişten tahsilat al | Tahsilatlar ekranında görünür | |
| 2.6 | Taksit planı kur (peşinat + 2 taksit) | Toplam = kalan borç; aksi halde uyarı verir | |
| 2.7 | Kalan borçtan **fazla** tahsilat dene | Engellenir / fazla ödeme olarak işaretlenir | |
| 2.8 | Tahsilat iptal et | Plan "tutarsız" işaretlenmez, bakiye doğru döner | |
| 2.9 | Tedarikçi → ürün adı değiştir | Yeni ad listede görünür, mükerrer kayıt oluşmaz | |
| 2.10 | Tedarikçi cari: borç + ödeme gir | Bakiye doğru; **aynı borç iki kez oluşmuyor** | |
| 2.11 | Cari ekstre → **PDF** (Windows) | Yazdırma penceresi açılır (eskiden hiçbir şey olmuyordu) | |
| 2.12 | Cari ekstre → **Excel** | .xlsx iner | |
| 2.13 | Ödeme yöntemi alanları | Hiçbir yerde `cash` / `bank_transfer` görünmüyor | |
| 2.14 | Montaj Takibi: "Yola çıktım" → "Montajda" → "Montaj tamamlandı" | Durum her adımda değişir | |

## 3. Muhasebeci

| # | Adım | Beklenen | Sonuç |
|---|------|----------|-------|
| 3.1 | Giriş | Muhasebe menüsü var, Personel/Süper Admin **yok** | |
| 3.2 | Gelir/gider kaydı | Ödeme yöntemi **açılır menü** (serbest metin değil) | |
| 3.3 | Tahsilat kaydı | Kasa ve Dashboard rakamları güncellenir | |
| 3.4 | Başka firmanın verisi | Hiçbir ekranda görünmüyor | |

## 4. Montajcı

| # | Adım | Beklenen | Sonuç |
|---|------|----------|-------|
| 4.1 | Giriş (telefondan) | Yalnızca montaj/saha ekranları | |
| 4.2 | Atanmış işler | Yalnızca kendisine atananlar | |
| 4.3 | Montaj durum butonları | Çalışır, tarih/saat kaydedilir | |
| 4.4 | İş fotoğrafı görüntüle | Fotoğraf açılır (imzalı adres) | |
| 4.5 | Hakediş ekranı | Yalnızca kendi hakedişi | |

## 5. Deneme süresi devam eden kullanıcı

| # | Adım | Beklenen | Sonuç |
|---|------|----------|-------|
| 5.1 | Giriş | **Normal giriş yapabilmeli** | |
| 5.2 | Üst bant | "X gün kaldı" doğru sayıyı gösterir | |
| 5.3 | Tüm modüller | Pakete dahil olanlar açık | |

## 6. Denemesi / lisansı bitmiş kullanıcı

| # | Adım | Beklenen | Sonuç |
|---|------|----------|-------|
| 6.1 | Giriş | `/locked` ekranı; uygulamaya girilemez | |
| 6.2 | URL'den `#/dashboard` yazarak atlatmayı dene | Yine `/locked` | |
| 6.3 | Süper admin denemeyi uzatır | Kullanıcı yeniden girebilir | |

## 7. Davet edilmiş fakat onaylanmamış kullanıcı

| # | Adım | Beklenen | Sonuç |
|---|------|----------|-------|
| 7.1 | Davet e-postası geldi mi | Geldi / gelmedi (gelmediyse Supabase Auth → Logs'a bakın) | |
| 7.2 | Davet kodu ile kayıt | Hesap oluşur | |
| 7.3 | Onay öncesi giriş | "Yetki bulunamadı" ekranı | |
| 7.4 | **"Tekrar dene" butonu** | Çıkış yapmadan kontrolü yeniden çalıştırır | |
| 7.5 | Admin onayladıktan sonra "Tekrar dene" | Uygulamaya girer | |

## 8. Firma izolasyonu (en kritik)

İki ayrı firmanın admin'i ile aynı anda oturum açın.

| # | Adım | Beklenen | Sonuç |
|---|------|----------|-------|
| 8.1 | A firmasının müşteri listesi | B'nin müşterileri **yok** | |
| 8.2 | B'nin sipariş id'sini A'nın URL'ine yaz | Erişilemez / boş | |
| 8.3 | Tahsilat, cari, tedarikçi, bildirim | Karışma yok | |
| 8.4 | **Fotoğraf** — B'nin fotoğraf adresini A'da aç | Erişilemez | |

> ⚠️ 8.4 şu anda **BAŞARISIZ OLUR**. Storage bucket'ları hâlâ public
> (bkz. `supabase_storage_tenant_isolation.sql`). Kod tarafı imzalı adrese
> geçirildi; o SQL uygulanana kadar eski public adresler çalışmaya devam eder.

## 9. Bağlantı / dayanıklılık

| # | Adım | Beklenen | Sonuç |
|---|------|----------|-------|
| 9.1 | Uygulama açıkken interneti kes, geri aç | Oturum düşmez | |
| 9.2 | Zayıf bağlantıda giriş | "Yetki bulunamadı"na düşerse "Tekrar dene" çalışır | |
| 9.3 | Telefonda uygulamayı kapat/aç | Oturum korunur | |

## 10. Gerçek cihaz

| # | Adım | Windows | Android |
|---|------|---------|---------|
| 10.1 | Kurulum / açılış | | |
| 10.2 | Dikey + yatay ekran | — | |
| 10.3 | PDF / yazdırma | | |
| 10.4 | Fotoğraf çekme + yükleme | | |
| 10.5 | Excel indirme | | |
| 10.6 | Splash + ikon + uygulama adı | | |
