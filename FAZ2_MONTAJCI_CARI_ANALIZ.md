# FAZ 2: MONTAJCI CARİ & HAKEDİŞ SİSTEMİ
## Kapsamlı Veritabanı Analizi Raporu

**Tarih:** 2026-06-19  
**Proje:** Solo Perdeci Satış Odaklı Geliştirme  
**Faz:** 2 - Montajcı Cari ve Hakediş

---

## 1. MEVCUT TABLO YAPISININ ANALIZI

### 1.1 MONTAJCI/ÇALIŞAN YÖNETİMİ
```
✅ installation_jobs
   ├─ id (uuid)
   ├─ company_id (uuid)
   ├─ order_id (uuid) → orders.id
   ├─ customer_id (uuid)
   ├─ assigned_staff_id (uuid) ← MONTAJCI ID
   ├─ status (text): 'waiting'|'scheduled'|'in_progress'|'completed'|'cancelled'
   ├─ scheduled_date (date)
   ├─ scheduled_time (time)
   ├─ width, height (numeric) ← m² HESAPLAMA İÇİN
   ├─ total_amount (numeric) ← SİPARİŞ TUTARI
   └─ created_at, updated_at

📍 DURUM: Montaj işlerini track ediyor
⚠️ EKSİK: Montajcı hakediş sistemi yok
```

### 1.2 MONTAJCI CARİ SİSTEMİ (VAR)
```
✅ installer_transactions
   ├─ id (uuid)
   ├─ company_id (uuid)
   ├─ installer_id (uuid) ← MONTAJCI ID
   ├─ transaction_date (timestamptz)
   ├─ transaction_type (text): 'payment'|'cancel'
   ├─ amount (numeric)
   ├─ description (text)
   ├─ payment_method (text)
   ├─ period_start, period_end (date)
   ├─ expense_id (uuid) ← muhasebe senkronizasyonu
   └─ created_at

📍 DURUM: Cari hareketleri (payment, cancel) track ediyor
⚠️ EKSİK: Hakediş (earning/commission) türü yok
```

### 1.3 MONTAJCI ÖDEMELERI (VAR)
```
✅ installer_payments
   ├─ id (uuid)
   ├─ company_id (uuid)
   ├─ installer_id (uuid)
   ├─ order_id (uuid)
   ├─ payment_date (timestamptz)
   ├─ amount (numeric)
   ├─ payment_method (text)
   ├─ note (text)
   └─ created_at

📍 DURUM: Yapılan ödeme kayıtları
⚠️ SORUN: Hakediş hesabı dinamik değil, manual kaydediliyor
```

### 1.4 SİPARİŞ VE ÜRÜN BİLGİLERİ
```
✅ orders
   ├─ id (uuid)
   ├─ customer_id (uuid)
   ├─ company_id (uuid)
   ├─ total_amount (numeric)
   ├─ status (text): 'new_order'|'draft'|'measured'|'quoted'|'approved'|
   │                  'production'|'installation_ready'|'installing'|
   │                  'installation_completed'|'delivered_closed'|'completed'|...
   └─ ...

✅ order_items
   ├─ id (uuid)
   ├─ order_id (uuid)
   ├─ company_id (uuid)
   ├─ product_type (text)
   ├─ qty (numeric) ← ADET BAZLI HAKEDİŞ
   ├─ unit_price (numeric)
   ├─ line_total (numeric)
   ├─ width_cm, height_cm (numeric)
   ├─ area_m2 (numeric) ← M² BAZLI HAKEDİŞ
   ├─ supplier_id (uuid)
   ├─ supplier_total_cost (numeric)
   ├─ profit (numeric)
   └─ ...

📍 DURUM: Ürün-adet-alan bilgisi mevcut
✅ HAZIR: Hakediş hesaplamak için gereken tüm veriler var
```

### 1.5 RANDEVU & MONTAJ BAĞLANTISI
```
✅ appointments
   ├─ id (uuid)
   ├─ type (text): 'measurement'|'quote'|'installation'|...
   ├─ status (text): 'planned'|'completed'|'cancelled'|...
   ├─ order_id (uuid)
   ├─ assigned_user_id (uuid) ← MONTAJCI (staff)
   └─ ...

📍 DURUM: Montaj randevuları ve atama bilgisi
✅ HAZIR: Montaj başlangıcı/bitişi takibi yapılabilir
```

---

## 2. HAKEDIŞ SİSTEMİ TASARIMI

### 2.1 HAKEDIŞ HESAPLAMA MODELLERI

#### Model A: ADET BAZLI HAKEDİŞ
```
Formül: qty × unit_hakediş_fiyati

Örnek:
  - Ürün: Stor Perde
  - Birim Hakediş: 50 TL/adet
  - Miktar: 3 adet
  ────────────────
  Hakediş: 150 TL
```

#### Model B: M² BAZLI HAKEDİŞ
```
Formül: area_m2 × unit_hakediş_fiyati_m2

Örnek:
  - Ürün: Tül Perde
  - Birim Hakediş: 80 TL/m²
  - Alan: 5 m²
  ────────────────
  Hakediş: 400 TL
```

#### Model C: HYBRID HAKEDIŞ
```
Formül: (qty × birim_hakediş) + (area_m2 × m2_hakediş)

Örnek:
  - Adet Hakediş: 3 × 50 TL = 150 TL
  - m² Hakediş: 5 × 80 TL = 400 TL
  ────────────────
  Toplam: 550 TL
```

#### Model D: MANUEL HAKEDİŞ
```
Admin tarafından manuel olarak girilebilir
- Sabit tutar
- Yüzde tabanlı (toplam tutarın % kaçı)
- Ayarlama (+ veya -)
```

### 2.2 HAKEDİŞ WORKFLOW

```
1. MONTAJ İŞİ OLUŞTURULDUĞUNDA
   ├─ installation_job oluşturulur
   ├─ assigned_staff_id = montajcı
   └─ status = 'waiting'

2. MONTAJ BAŞLANDIĞINDA
   ├─ status = 'in_progress'
   └─ başlangıç_tarihi kaydedilir

3. MONTAJ TAMAMLANDIĞINDA
   ├─ status = 'installation_completed'
   ├─ bitişi_tarihi kaydedilir
   ├─ OTOMATIK HAKEDİŞ HESAPLA
   │  ├─ Malzeme hakediş (adet/m²)
   │  ├─ İşçilik hakediş (adet/m²)
   │  ├─ Ek hakediş (manual)
   │  └─ TOPLAM
   └─ installer_transactions'a 'hakediş' türü hareket yaz

4. MONTAJCI BAKIYE
   ├─ Toplam Hakediş = SUM(hakediş türü hareketleri)
   ├─ Yapılan Ödemeler = SUM(payment türü hareketleri)
   └─ Kalan Bakiye = Toplam - Ödemeler

5. ÖDEME YAPILDIĞINDA
   ├─ installer_transactions'a 'payment' kaydı
   └─ balance otomatik güncellenir
```

---

## 3. YENİ TABLOLAR TASARIMI

### 3.1 `installer_commissions` TABLOSU (YENİ)
```
Montajcı için tanımlanmış hakediş kuralları

Columns:
  id (uuid) PRIMARY KEY
  company_id (uuid) REFERENCES companies
  installer_id (uuid) REFERENCES employees/profiles
  
  commission_type (text): 'quantity'|'area'|'percentage'|'fixed'
  
  -- Adet bazlı
  unit_commission_amount (numeric) -- her adet için TL
  
  -- m² bazlı
  area_commission_amount (numeric) -- her m² için TL
  
  -- Yüzde bazlı
  percentage (numeric) -- toplam tutarın % kaçı
  
  -- Ek komyon
  fixed_amount (numeric) -- sabit bonus
  
  product_type (text) -- hangi ürüne uygulanır (null = tümü)
  is_active (boolean)
  created_at (timestamptz)
  updated_at (timestamptz)

📊 HESAPLAMA:
  - Adet: order_items.qty × unit_commission_amount
  - m²: order_items.area_m2 × area_commission_amount
  - %: order_items.line_total × (percentage / 100)
  - Sabit: fixed_amount
```

### 3.2 `installer_earnings` TABLOSU (YENİ)
```
Montajcı hakediş kayıtları (automatic + manual)

Columns:
  id (uuid) PRIMARY KEY
  company_id (uuid)
  installer_id (uuid)
  installation_job_id (uuid) REFERENCES installation_jobs
  order_id (uuid) REFERENCES orders
  
  earning_date (timestamptz) -- montaj bitişi tarihi
  earning_type (text): 'quantity'|'area'|'fixed'|'manual'|'adjustment'
  earning_amount (numeric)
  
  -- Hesaplama detayları
  calculation_method (text) -- ne nasıl hesaplandı
  quantity (numeric) -- kullanılan adet
  area_m2 (numeric) -- kullanılan alan
  unit_rate (numeric) -- birim fiyat
  
  description (text)
  notes (text)
  
  -- Bağlantılar
  created_by (uuid) -- admin/auto
  approved_by (uuid) -- onay gerekliyse
  approved_at (timestamptz)
  
  created_at (timestamptz)
  updated_at (timestamptz)
  
📊 KULLANIM:
  - Her montaj tamamlandığında otomatik kayıt
  - Admin manuel ekleme/düzenleme yapabilir
  - Onay workflow'u opsiyonel
```

### 3.3 MEVCUT TABLOYU GENIŞLET: `installer_transactions`
```
Yeni column eklenecek:
  - earning_id (uuid) REFERENCES installer_earnings
  - earning_source (text): 'commission'|'bonus'|'penalty'|...
  - related_order_id (uuid) -- hangi siparişle ilgili
  
İşlev:
  - 'earning' türünde hareketler hakediş
  - 'payment' türünde hareketler ödeme
  - 'cancel' türünde hareketler iptal
  - 'adjustment' türünde hareketler düzeltme
```

---

## 4. TRIGGER & OTOMASYONLAR

### 4.1 TRIGGER 1: Montaj tamamlandığında otomatik hakediş
```
ON: installation_jobs UPDATE
WHEN: status = 'installation_completed'

ACTION:
  1. installer_earnings kaydı oluştur
  2. Hakediş tutarını hesapla (commission rules'a göre)
  3. installer_transactions'a 'earning' türü hareket yaz
  4. Bakiye otomatik güncellenir
```

### 4.2 TRIGGER 2: Montaj silinince hakediş iptal
```
ON: installation_jobs DELETE
WHEN: status IN ('installation_completed', 'installation_waiting')

ACTION:
  1. İlişkili installer_earnings'i mark as cancelled
  2. installer_transactions'a 'cancel' türü hareket yaz
```

### 4.3 TRIGGER 3: Ödeme yapılınca bakiye
```
ON: installer_transactions INSERT
WHEN: transaction_type = 'payment'

ACTION:
  1. Otomatik balance hesapla
  2. Expense record senkronizasyonu (Muhasebe modülü)
```

---

## 5. RPC FUNCTIONS (SORGU HIZLANDIRMASI)

### 5.1 `get_installer_cari_summary(installer_id, company_id)`
```
RETURNS:
  - total_earnings (numeric) -- toplam hakediş
  - total_paid (numeric) -- yapılan ödemeler
  - total_adjustments (numeric) -- düzeltmeler
  - balance (numeric) -- kalan bakiye
  - last_earning_date (timestamptz)
  - last_payment_date (timestamptz)
  - transaction_count (bigint)
```

### 5.2 `get_installer_ledger(installer_id, company_id, limit)`
```
RETURNS: (per row)
  - id (uuid)
  - transaction_date (timestamptz)
  - transaction_type (text)
  - earning_type (text) -- qualification
  - amount (numeric)
  - description (text)
  - order_id (uuid)
  - installation_job_id (uuid)
  - running_balance (numeric)
```

### 5.3 `calculate_installation_commission(job_id, installer_id)`
```
RETURNS:
  - quantity_commission (numeric)
  - area_commission (numeric)
  - fixed_commission (numeric)
  - total_commission (numeric)
  - calculation_breakdown (jsonb)
```

### 5.4 `get_installer_performance(installer_id, period_start, period_end)`
```
RETURNS:
  - jobs_completed (integer)
  - total_area_m2 (numeric)
  - total_items (integer)
  - total_earnings (numeric)
  - average_job_value (numeric)
  - completion_rate (numeric)
```

---

## 6. FRONTEND SAYFALAR DÜZENLEMESI

### 6.1 MEVCUT SAYFALARDA DEĞİŞİKLİK

#### `src/pages/InstallationTracking.tsx`
```
Mevcut: Montajcıların günlük rotası
Eklenecek:
  ├─ Montaj tamamlandığında otomatik hakediş şimdi görünsün
  ├─ "Hakediş Detayları" inline gösterimi
  └─ Ödeme istatistikleri widget'ı
```

#### `src/pages/Installations.tsx` (veya InstallerLedger.tsx)
```
YENİ: Montajcı Hakediş ve Cari Ekranı
  ├─ Filtreleme: Tarih Aralığı, Ürün Tipi, Status
  ├─ Özet Widget'ları:
  │  ├─ Toplam Hakediş (TL)
  │  ├─ Yapılan Ödemeler (TL)
  │  └─ Kalan Bakiye (TL)
  ├─ Tablo: İş Geçmişi
  │  ├─ Tarih
  │  ├─ Montaj İşi Detayları
  │  ├─ Adet / m²
  │  ├─ Hakediş Tutarı
  │  └─ Status
  └─ Ödeme Formu (Modal)
```

### 6.2 YENİ SAYFALAR

#### `src/pages/InstallerCommissionSettings.tsx`
```
Admin paneli: Montajcı hakediş kuralları tanımlama
  ├─ Montajcı seçimi
  ├─ Commission Type: Adet / m² / % / Sabit
  ├─ Ürün Türü Filtresi (opsiyonel)
  └─ Onayla & Kaydet
```

#### `src/pages/InstallerEarningsDetail.tsx`
```
Montajcı detay sayfası
  ├─ Cari Özeti
  ├─ Hakediş Geçmişi (RPC ile)
  ├─ Ödeme Geçmişi (RPC ile)
  ├─ Manuel Hakediş Ekleme (admin)
  └─ Performans İstatistikleri (RPC)
```

---

## 7. KAPSAMDAKİ TABLOLAR

### Kullanılacak Tablolar:

| Tablo | Durum | Amaç |
|-------|-------|------|
| `orders` | ✅ Mevcut | Sipariş bilgisi |
| `order_items` | ✅ Mevcut | Ürün, adet, m², tutar |
| `installation_jobs` | ✅ Mevcut | Montaj işi takibi |
| `appointments` | ✅ Mevcut | Montaj randevu |
| `installer_transactions` | ✅ Mevcut | Cari hareketler (genişletilecek) |
| `installer_payments` | ✅ Mevcut | Yapılan ödemeler |
| `installer_commissions` | 🆕 OLUŞTURULACAK | Hakediş kuralları |
| `installer_earnings` | 🆕 OLUŞTURULACAK | Hakediş kayıtları |

### Değiştirilecek Tablolar:

| Tablo | Değişiklik |
|-------|-----------|
| `installer_transactions` | +earning_id, +earning_source, +related_order_id |

---

## 8. SECURITY & RLS POLICIES

```
✅ Montajcı: Kendi işlerini ve cari bakiyesini görebilir
✅ Admin: Tüm montajcıları görebilir
✅ Super Admin: Tüm verileri görebilir
✅ Muhasebe: Ödeme verilerini görebilir
```

---

## 9. IMPLEMENTATION TIMELINE

### Phase 2.1: Database & Backend
- [ ] `installer_commissions` tablosu oluştur
- [ ] `installer_earnings` tablosu oluştur
- [ ] Triggers ve RPC functions yaz
- [ ] RLS policies ekle

### Phase 2.2: Frontend Entegrasyonu
- [ ] InstallationTracking güncelleştir
- [ ] InstallerEarningsDetail sayfası
- [ ] InstallerCommissionSettings sayfası
- [ ] Mobile responsive test

### Phase 2.3: Testing & Validation
- [ ] Unit tests
- [ ] Integration tests
- [ ] User acceptance test (montajcı)
- [ ] Admin test

---

## 10. KRİTİK NOTLAR

### Avantajlar:
✅ Tamamen otomatik (manual giriş yok)
✅ Real-time balance tracking
✅ Audit trail (tüm hareketler kaydediliyor)
✅ Esneklik (adet/m²/% kombinasyonu)
✅ Multi-company support

### Riskler & Mitigasyon:
⚠️ Hatalı montaj = hatalı hakediş
   → Admin manuel düzeltme imkanı

⚠️ Periyodik ödeme gerekebilir
   → Bulk payment feature ekleme

⚠️ Dispatcher'ın montajcı ataması değişirse
   → Re-assign logic'i tanımla

---

## ONAY ALINMASINI BEKLENEN MADDELER

1. **Hakediş Modelleri**: Adet/m²/Hybrid/Manual → Onay
2. **Otomasyonlar**: Trigger tabanlı → Onay
3. **Yeni Tablolar**: installer_commissions + installer_earnings → Onay
4. **Frontend**: 2 yeni sayfa + 1 mevcut güncelleme → Onay

---

**STATUS:** ⏳ ANALİZ TAMAMLANDI, ONAY BEKLENİYOR
