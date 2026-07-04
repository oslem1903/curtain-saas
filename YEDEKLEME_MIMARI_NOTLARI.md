# Yedekleme / Excel Dışa Aktarma — Mimari Notlar

> **DURUM: PLANLAMA — P1 Production Readiness.**
> Bu belge yalnızca mimari hazırlık notudur. **Bu özellik için P0 çekirdek
> sistemi tamamlanmadan hiçbir tablo, migration, RPC, Edge Function veya UI
> geliştirilmeyecektir.** Geliştirme, [ROADMAP.md](./ROADMAP.md) içindeki P0
> çekirdek sistemi (madde 1–13) tamamlandıktan sonra başlar; ancak canlı
> yayına çıkmadan önce P1 fazının bir parçası olarak eksiksiz tamamlanır.

---

## 1. Amaç ve Kapsam

İki ayrı ama ilişkili yetenek hedeflenir:

1. **Excel / CSV Dışa Aktarma (kullanıcıya yönelik)**
   - Liste/rapor ekranlarındaki verinin (ölçü, teklif, sipariş, montaj,
     tedarikçi cari, montajcı cari, tahsilatlar) `.xlsx` / `.csv` indirilmesi.
   - Filtre/tarih aralığı bazlı, tek tablo odaklı çıktı.

2. **Yedekleme (şirket/operasyon yönetimine yönelik)**
   - Bir şirketin (`company_id`) tüm operasyonel verisinin tutarlı bir
     anlık görüntü (snapshot) olarak alınması.
   - Manuel tetikleme + (ileride) zamanlanmış otomatik yedek.

> Bu iki yetenek ayrı ele alınmalıdır: dışa aktarma "okuma + biçimlendirme",
> yedekleme "tutarlı snapshot + saklama + geri yükleme" problemidir.

---

## 2. Mevcut Mimariyle Uyum

- **Stack:** React + TypeScript + Vite (web), Capacitor (mobil), Electron/asar
  (masaüstü), Supabase (Postgres + RLS + Auth + Storage).
- **Çok kiracılı (multi-tenant):** Tüm operasyonel veri `company_id` ile
  izole. Yedekleme/dışa aktarma **mutlaka** `company_id` sınırında çalışmalı;
  asla kiracılar arası veri sızdırmamalı.
- **Yetkilendirme:** RLS politikaları mevcut. Dışa aktarma RPC'leri
  `SECURITY DEFINER` ise, çağıran kullanıcının `company_id` ve rol kontrolü
  fonksiyon içinde **explicit** yapılmalı (RLS bypass riski).
- **Lisans sistemi:** Modül erişimi mevcut modüler-SaaS lisanslama ile gate
  edilmeli (bkz. `supabase_modular_saas_upgrade.sql`,
  `supabase_license_hardening.sql`). Yedekleme/dışa aktarma bir plan
  özelliği olarak işaretlenebilir.

---

## 3. Excel / CSV Dışa Aktarma — Tasarım Notları

- **Tercih edilen yaklaşım:** İstemci tarafı üretim (örn. SheetJS/`xlsx` veya
  CSV string) — sunucuya yük bindirmeden, mevcut yüklenmiş listelerden.
  - Büyük veri setlerinde sayfalama/streaming gerekebilir; ilk sürümde
    filtrelenmiş/sayfa bazlı export ile sınırlandırılabilir.
- **Sunucu tarafı alternatifi:** Supabase Edge Function ile sunucuda `.xlsx`
  üretimi — yalnızca büyük/standart raporlar için, RLS-uyumlu sorgularla.
- **Mevcut varlık:** Kökte `create_excel.py` var; bu bir geliştirme/seed
  yardımcı betiğidir, **ürün export modülü değildir** — karıştırılmamalı.
- **Biçim standartları:** Tarih/sayı/para birimi formatları TR yereline göre;
  kolon başlıkları kullanıcıya görünen etiketlerle eşleşmeli.
- **Mobil:** Capacitor'da dosya indirme/paylaşım native köprü gerektirir
  (Filesystem + Share plugin); web `Blob` indirme mobilde farklı davranır.

---

## 4. Yedekleme — Tasarım Notları

- **Tutarlılık:** Snapshot, ilişkili tablolar arası tutarlı olmalı (cari
  hareketler ↔ siparişler ↔ tahsilatlar). Tek transaction/`REPEATABLE READ`
  ile okunan bir RPC veya `pg_export`/logical dump yaklaşımı değerlendirilmeli.
- **Saklama:** Supabase Storage'da `company_id` bazlı izole bucket/prefix;
  erişim imzalı URL ile, süreli.
- **Geri yükleme (restore):** İlk sürümde **kapsam dışı** bırakılması önerilir
  (yalnızca dışa aktarma/yedek üretme). Restore ayrı bir tasarım ve risk
  analizini (idempotency, çakışma, FK sırası) gerektirir. Not: kökte
  `supabase_rollback_system.sql` mevcut — bu operasyonel rollback'tir,
  kullanıcı verisi yedekleme/geri yükleme ile **karıştırılmamalı**.
- **Zamanlama:** Otomatik yedek için Supabase scheduled function / cron;
  ilk sürümde manuel tetikleme yeterli.
- **KVKK/Gizlilik:** Yedek dosyaları kişisel veri içerir; saklama süresi,
  erişim ve silme politikaları tanımlanmalı.

---

## 5. Tek Tıkla Şirket Arşivi — Mimari Notlar

**Amaç:** Kullanıcı tek butonla şirketinin tüm verisini, dağıtılabilir tek bir
arşiv dosyası olarak dışarı alabilmeli.

- **Çıktı paketi:** `PerdePRO_{FirmaAdi}_{Tarih}.zip`
  - `{FirmaAdi}` dosya-sistemi güvenli hale getirilmeli (Türkçe karakter /
    boşluk / özel karakter sanitizasyonu).
  - `{Tarih}` standart format (öneri: `YYYY-AA-GG`).
- **İçerik yapısı:**
  - Kök Excel dosyaları: `Musteriler.xlsx`, `Siparisler.xlsx`,
    `Tahsilatlar.xlsx`, `Tedarikci_Hareketleri.xlsx`,
    `Montajci_Hareketleri.xlsx`, `Urunler.xlsx`, `Randevular.xlsx`
  - `PDF/` klasörü: Teklif PDF'leri, Ölçü Formları, Sipariş PDF'leri,
    Tahsilat Makbuzları (alt klasörlere ayrılması önerilir).
- **Bağımlılıklar:** Excel üretimi için Bölüm 3 (Dışa Aktarma), PDF üretimi
  için PDF Modülü (ROADMAP 2.3), tutarlı veri kümesi için Bölüm 4 (Yedekleme).
- **İzolasyon:** Tüm sorgular ve dosya toplama **yalnızca** çağıran kullanıcının
  `company_id` kapsamında. ZIP içine başka kiracının verisi/PDF'i girmemeli.
- **Üretim yeri:** Veri hacmine göre istemci (JSZip + SheetJS) veya Supabase
  Edge Function. PDF sayısı yüksekse sunucu tarafı paketleme + imzalı indirme
  URL'i tercih edilebilir.
- **Bellek/performans:** Büyük firmalarda ZIP'i bellekte tutmak yerine
  streaming/parça parça yazma; zaman aşımı ve ilerleme göstergesi planlanmalı.

---

## 6. Açık Sorular (Geliştirme Öncesi Karara Bağlanacak)

- Dışa aktarma istemci tarafı mı, Edge Function mı olacak? (veri hacmi kararı)
- Yedek formatı: tablo-başına `.xlsx`/`.csv` paketi mi, yoksa tek JSON snapshot mı?
- Restore ilk sürüme dahil mi? (öneri: hayır)
- Hangi roller export/yedek alabilir? (öneri: yalnızca admin/şirket sahibi)
- Lisans planlarında hangi katmana dahil edilecek?
- Şirket Arşivi ZIP'i istemcide mi, Edge Function'da mı paketlenecek?

---

## 7. Yapılmayacaklar (Bu Aşamada)

- ❌ Tablo / migration oluşturma
- ❌ RPC / Edge Function yazma
- ❌ UI bileşeni / ekran ekleme
- ❌ `package.json`'a export kütüphanesi ekleme

Bu maddeler P0 tamamlandıktan ve bu belgedeki açık sorular karara bağlandıktan
sonra ayrı bir iş kalemi olarak ele alınacaktır.
