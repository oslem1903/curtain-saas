# Ürün Yol Haritası (Roadmap)

> Bu belge canlı yayın öncesi fazları ve öncelik sırasını tanımlar.
> **Önceliklendirme bağlayıcıdır:** P0 çekirdek sistemi eksiksiz ve production
> kalitesinde tamamlanmadan P1 modüllerine başlanmaz; P1 eksiksiz
> tamamlanmadan da canlı yayına çıkılmaz.

---

## 1. Release Öncesi Çekirdek Sistem (P0 — Devam Ediyor)

Bu maddelerin tamamı production kalitesinde bitmeden release yapılmaz.

| #  | Modül                       | Durum   |
|----|-----------------------------|---------|
| 1  | Ölçü                        | —       |
| 2  | Teklif                      | —       |
| 3  | Sipariş                     | —       |
| 4  | Montaj                      | —       |
| 5  | Tedarikçi cari              | —       |
| 6  | Montajcı cari               | —       |
| 7  | Tahsilatlar                 | —       |
| 8  | Dashboard                   | —       |
| 9  | Mobil uyumluluk             | —       |
| 10 | Süper Admin                 | —       |
| 11 | Lisans sistemi              | —       |
| 12 | Tüm bugların giderilmesi    | —       |
| 13 | QA ve son testler           | —       |

> Durum kolonu ilgili modül sahibi tarafından güncellenir
> (`— / Devam Ediyor / Tamamlandı`).

---

## 2. P1 — Production Readiness (Canlı Yayın Öncesi Zorunlu)

Bu faz, **core iş akışları (P0) tamamlandıktan sonra** başlar; ancak
**canlı yayına çıkmadan önce eksiksiz tamamlanması zorunludur.** P1, "release
sonrası" değildir — release'in ön koşuludur.

> **Bağlayıcı Kurallar:**
> - P0 çekirdek sistemi tamamen bitmeden P1 modüllerine **başlanmaz.**
> - P1 eksiksiz tamamlanmadan **canlı yayına çıkılmaz.**
> - Bu aşamada **hiçbir kod yazılmaz, migration/tablo oluşturulmaz, API/UI
>   geliştirilmez.** Yalnızca roadmap ve mimari dokümantasyon üretilir.

**Amaç:** PerdePRO'nun canlı yayına çıkmadan önce eksiksiz bir Production
Readiness planına sahip olması.

### P1 Modül Özeti

| #   | Modül                          | Önkoşul | Durum |
|-----|--------------------------------|---------|-------|
| 2.1 | Veri Yedekleme                 | P0      | —     |
| 2.2 | Tek Tıkla Şirket Arşivi        | P0, 2.1 | —     |
| 2.3 | PDF Modülü                     | P0      | —     |
| 2.4 | Raporlama                      | P0      | —     |
| 2.5 | Bildirim Merkezi               | P0      | —     |
| 2.6 | Log Sistemi                    | P0      | —     |
| 2.7 | Performans                     | P0      | —     |
| 2.8 | Güvenlik (Son Kontroller)      | P0, tümü| —     |

> Durum kolonu ilgili modül sahibi tarafından güncellenir
> (`— / Devam Ediyor / Tamamlandı`). Tüm satırlar `Tamamlandı` olmadan canlı
> yayına çıkılmaz.

---

### 2.1 Veri Yedekleme

- [ ] Manuel Excel dışa aktarma
- [ ] Otomatik aylık yedekleme
- [ ] Geçmiş yedekler ekranı
- [ ] Firma bazlı güvenli yedekleme
- [ ] `company_id` izolasyonu (zorunlu — kiracılar arası sızıntı yasak)
- [ ] Supabase Storage mimarisi (firma bazlı izole bucket/prefix, süreli imzalı URL)
- [ ] Geri yükleme özelliği — **İlk sürümde YAPILMAYACAK; yalnızca roadmap notu**

**Mimari notlar:** [YEDEKLEME_MIMARI_NOTLARI.md](./YEDEKLEME_MIMARI_NOTLARI.md)

---

### 2.2 Tek Tıkla Şirket Arşivi

**Amaç:** Kullanıcı tek butonla şirketinin tüm verisini dışarı alabilmeli.

**Oluşturulacak arşiv örneği:**

```
PerdePRO_{FirmaAdi}_{Tarih}.zip
```

**İçerik:**

- Excel dosyaları:
  - [ ] `Musteriler.xlsx`
  - [ ] `Siparisler.xlsx`
  - [ ] `Tahsilatlar.xlsx`
  - [ ] `Tedarikci_Hareketleri.xlsx`
  - [ ] `Montajci_Hareketleri.xlsx`
  - [ ] `Urunler.xlsx`
  - [ ] `Randevular.xlsx`
- PDF klasörü:
  - [ ] Teklif PDF'leri
  - [ ] Ölçü Formları
  - [ ] Sipariş PDF'leri
  - [ ] Tahsilat Makbuzları

**Notlar:** Arşiv üretimi `company_id` sınırında çalışmalı; ZIP paketleme ve
Excel/PDF üretimi 2.1 (Veri Yedekleme) ve 2.3 (PDF Modülü) altyapısını
kullanır. Bu modül şu an **yalnızca roadmap ve mimari not** seviyesindedir.

---

### 2.3 PDF Modülü

- [ ] Ölçü Formu PDF
- [ ] Teklif PDF
- [ ] Sipariş PDF
- [ ] Tahsilat Makbuzu
- [ ] Cari Ekstre
- [ ] Firma Logolu Belgeler

---

### 2.4 Raporlama

- [ ] Satış Raporları
- [ ] Kârlılık Analizi
- [ ] Tedarikçi Raporları
- [ ] Montajcı Performansları
- [ ] Tahsilat Analizleri
- [ ] En Çok Satılan Ürünler
- [ ] Aylık / Yıllık Grafikler

---

### 2.5 Bildirim Merkezi

- [ ] Termin Hatırlatma
- [ ] Randevu Hatırlatma
- [ ] Tahsilat Vadesi
- [ ] Tedarikçi Ödemesi
- [ ] Montaj Tarihi
- [ ] Lisans Bitiş Tarihi

---

### 2.6 Log Sistemi (Audit Trail)

- [ ] Kim hangi kaydı değiştirdi
- [ ] Ne zaman değiştirdi
- [ ] Eski değer
- [ ] Yeni değer
- [ ] Silinen kayıt geçmişi
- [ ] Sistem hata kayıtları

---

### 2.7 Performans

- [ ] Büyük veri testi
- [ ] 10.000+ müşteri testi
- [ ] Performans optimizasyonu
- [ ] Mobil performans testi
- [ ] SQL optimizasyonları

---

### 2.8 Güvenlik (Son Kontroller)

- [ ] RLS kontrolleri
- [ ] Yetki doğrulamaları
- [ ] Dosya erişim güvenliği
- [ ] SQL Injection kontrolleri
- [ ] XSS kontrolleri
- [ ] Audit kontrolleri

---

> ⚠️ Yukarıdaki tüm P1 modülleri için P0 tamamlanmadan kod, şema, migration,
> API veya arayüz üretilmez. Bu belge yalnızca planlama amaçlıdır.

---

## 3. V1.0 Yayın Kriterleri (Definition of Done)

PerdePRO'nun canlı yayına çıkabilmesi için aşağıdaki maddelerin **tamamı**
sağlanmış olmalıdır. Bu liste PerdePRO V1.0'ın resmi yayın planıdır ve
bağlayıcıdır — herhangi bir madde eksikken yayına çıkılmaz.

> Aşağıdaki kutucuklar yalnızca ilgili madde gerçekten doğrulandığında
> işaretlenir. `✓` işareti "tamamlandı ve doğrulandı" anlamına gelir.

### 3.1 Core Sistem

- [ ] Ölçü modülü tamamlandı
- [ ] Teklif modülü tamamlandı
- [ ] Sipariş modülü tamamlandı
- [ ] Montaj modülü tamamlandı
- [ ] Tedarikçi cari sistemi tamamlandı
- [ ] Montajcı cari sistemi tamamlandı
- [ ] Tahsilat sistemi tamamlandı
- [ ] Dashboard gerçek verilerle çalışıyor

### 3.2 Kalite

- [ ] Critical bug = 0
- [ ] High severity bug = 0
- [ ] Build başarılı
- [ ] TypeScript hata yok
- [ ] ESLint temiz
- [ ] Production build başarılı

### 3.3 Performance

- [ ] Büyük veri testleri tamamlandı
- [ ] En az 10.000 müşteri testi
- [ ] Büyük sipariş listelerinde performans kabul edilebilir
- [ ] Mobil performans doğrulandı

### 3.4 Security

- [ ] RLS doğrulandı
- [ ] Yetki kontrolleri tamamlandı
- [ ] `company_id` izolasyonu doğrulandı
- [ ] Dosya erişimleri doğrulandı
- [ ] Audit kontrolleri tamamlandı

### 3.5 Production Readiness

- [ ] Excel dışa aktarma tamamlandı
- [ ] Veri yedekleme tamamlandı
- [ ] PDF modülü tamamlandı
- [ ] Bildirim sistemi tamamlandı
- [ ] Log sistemi tamamlandı
- [ ] Raporlama tamamlandı

### 3.6 QA

- [ ] Uçtan uca testler tamamlandı
- [ ] Manuel test senaryoları geçti
- [ ] Mobil testler tamamlandı
- [ ] Responsive kontroller tamamlandı

### 3.7 Dokümantasyon

- [ ] Kullanım dokümanı
- [ ] Kurulum dokümanı
- [ ] Sürüm notları
- [ ] Değişiklik geçmişi
- [ ] Lisans dokümanı

### 3.8 Release

Yalnızca yukarıdaki tüm maddeler (3.1–3.7) tamamlandıktan sonra:

- [ ] Release Candidate oluşturulacak
- [ ] Son smoke test yapılacak
- [ ] V1.0 etiketi oluşturulacak
- [ ] Canlı yayına çıkılacak

---

## 4. Kapsam Dondurma (Scope Freeze)

> **Roadmap bu aşamadan sonra kapsam olarak dondurulmuştur. Yeni özellikler
> V1.1 ve sonraki sürümler için backlog'a alınacaktır. V1.0 geliştirme
> sürecinde yalnızca kritik hata düzeltmeleri ve yayın engelleyici eksiklikler
> roadmap'e eklenebilir.**
