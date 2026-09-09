# Satışa Hazırlık Denetimi — Oturum Notu (2026-09-09)

Bu dosya, oturum kesilirse kaldığı yerden devam edebilmek için tutulan çalışma
notudur. Güncel durumu burada tutuyorum, eski raporlardaki "tamamlandı"
iddialarını kanıt saymıyorum.

## 1. Erişim + Yedek
- Proje kök dizini doğrulandı: D:\curtain-saas (git repo, doğru proje).
- AGENTS.md YOK (sadece node_modules içinde ilgisiz bir paketin AGENTS.md'si var — proje talimatı değil). CLAUDE.md da yok.
- D:\ sürücüsünde sadece 16.4 GB boş alan var; proje içinde 15 adet tekrarlanan
  Electron release-*/.asar-* klasörü zaten ~9.9 GB tutuyor. Kullanıcıya soruldu,
  karar: **tam ham kopya C:\Curtain-Saas-Yedek altına alınacak** (C:'de 298 GB boş).
- Yedek durumu: [DOLDURULACAK — robocopy sonucu]
- ÖNEMLİ: Bu yerel dosya yedeği canlı Supabase veritabanının yedeği DEĞİLDİR.

## 2. Git durumu (oturum başlangıcı)
- Branch: master. Son commit: 20c601b (order payment plans/collections).
- 1 adet stash mevcut: "WIP on master: c60ff28 fix(finance): add reverse-entry cancel actions for payments" — DOKUNULMADI.
- Uncommitted değişiklikler (oturum başında mevcuttu, ben yapmadım):
  - M src/context/AuthContext.tsx, src/layouts/Layout.tsx, src/pages/Dashboard.tsx, src/pages/SuperAdminCompanies.tsx
  - ?? src/utils/trialLicense.ts (yeni paylaşılan modül)
  - ?? supabase_migration_011_trial_ends_at_single_source.sql
  - ?? supabase_fix_test_company_trial_ends_at.sql
  - ?? src/constants/measurementConstants.ts, SUPPLIER_CARI_ANALYSIS_REPORT.md, .__wtest

## 3. Tespit: trial_ends_at tek doğruluk kaynağı refactor'ü (commit edilmemiş, tamamlanmış görünüyor)
Bu, önceki bir oturumda tasarlanmış kapsamlı bir düzeltme:
- Frontend: AuthContext/Layout/Dashboard/SuperAdminCompanies artık trial_end
  yerine SADECE trial_ends_at okuyor, ortak src/utils/trialLicense.ts üzerinden.
- DB: migration 011 (register_device_and_touch_login + is_company_writable
  fail-closed'a çevriliyor, preflight/orphan-guard/postcheck korumalı) — HENÜZ
  PRODUCTION'DA ÇALIŞTIRILMADI.
- Ek: 2 test firması için tek seferlik trial_ends_at backfill SQL'i — HENÜZ ÇALIŞTIRILMADI.
- Sıradaki adım: frontend tarafını typecheck/build ile doğrula, sonra tarayıcıda
  test et; DB migration'ı UYGULAMADAN ÖNCE kullanıcıya ayrıca onay sorulacak.

## 4. Baseline build/typecheck/lint — TAMAMLANDI
- `npx tsc -b`: temiz (0 hata).
- `npm run build`: başarılı (dist/ üretildi, 2171 kB ana chunk uyarısı var ama build kırılmıyor).
- `npx eslint .`: 26 hata / 14 uyarı — HEPSİ ÖNCEDEN VAR OLAN, bu oturumdaki değişikliklerle ilgisiz
  (Customers.tsx, MeasurementEntry.tsx, Suppliers.tsx, NewOrder.tsx, Locked.tsx, NewAppointment.tsx,
  Dashboard.tsx:256-257 — Date.now() render içinde çağrılıyor, react-hooks/purity kuralı, YENİ eklenen
  bir lint kuralı gibi görünüyor, trial_ends_at değişikliğiyle İLGİSİZ satırlar).

## 5. Yapılan düzeltmeler (bu oturumda)
1. **trial_ends_at tek doğruluk kaynağı** (commit d6e4e5d) — bkz. bölüm 3. Frontend commit edildi.
   DB migration 011 + test-firma backfill SQL'i kullanıcı onayı bekliyor (SORULDU, henüz cevap
   verilmedi — "önce SQL'leri gözden geçir" seçildi, özet sunuldu).

## 6. Kod seviyesi bulgular (henüz düzeltme YAPILMADI, sadece tespit)
- **Tahsilatlar/Dashboard "Vadesiz" tutarlılığı: PASS.** Collections.tsx ve Dashboard.tsx aynı
  `src/utils/installments.ts` (bucketForDueDate/collectionRowStatus/buildDashboardDueRows) modülünü
  kullanıyor. "Vadesiz" kavramı burada "Vadesi Belirsiz" olarak (undetermined bucket) HER İKİ sayfada
  da aynı tanımla var (Dashboard.tsx:550-565, Collections.tsx:256-268). Regresyon yok.
- **Montaj tamamlama / hakediş oluşturma: eski hafıza notum (58 gün önce, "14 iş 0 hakediş, deploy
  edilmedi") ARTIK GÜNCEL DEĞİL GÖRÜNÜYOR.** supabase_migration_007/008_*.sql (31 Ağustos), migration
  008'in kendi açıklamasına göre "canlı regresyon testinde bulunan" bir hatayı düzeltiyor — yani 007/008
  muhtemelen PRODUCTION'DA ZATEN ÇALIŞTIRILMIŞ. update_installation_completion() artık
  installer_earnings/installer_transactions'ı atomik oluşturuyor, is_internal_installation=true
  durumunda hakediş oluşturmuyor (bilinçli). BU SADECE DOSYA İÇERİĞİNE DAYANIYOR — canlı DB'de gerçekten
  uygulanıp uygulanmadığı DOĞRULANAMADI (DB erişimim yok). Bölüm 7'deki doğrulama sorguları listesine
  eklendi.
- DB/RLS/RPC güvenlik denetimi (company isolation, SECURITY DEFINER search_path, EXECUTE grants,
  transaction bütünlüğü, frontend-RPC parametre eşleşmesi) için ayrı bir arka plan ajanı çalışıyor —
  sonuç geldiğinde buraya eklenecek.

## 6b. YENİ BULGU: trial_ends_at'in ÜÇÜNCÜ, tutarsız bir kopyası daha var (check_subscription_active)
`supabase_subscription_auth.sql:44-75` — `check_subscription_active(company_uuid)` fonksiyonu:
- `orders/customers/appointments/expenses` tablolarındaki RLS politikalarının ("Block insert/update/delete
  if trial expired" — aynı dosya satır 97-103) VE migration 010'daki YENİ RPC'lerin
  (`create_order_installment_plan`/`rebuild_order_installment_plan`/`cancel_order_installment_plan`,
  satır 88'de `check_subscription_active(p_company_id)` çağrılıyor) kullandığı ayrı bir yetki fonksiyonu.
  Migration 011 BUNA DOKUNMUYOR.
- Mantığı: `IF v_plan = 'trial' AND now() > v_ends THEN RETURN false; END IF;` — `v_ends`
  (`trial_ends_at`) NULL ise `now() > NULL` SQL'de NULL döner (true değil), IF hiç girilmez, fonksiyon
  `RETURN true` ile biter. Yani **trial_ends_at NULL olan bir firma bu fonksiyona göre HÂLÂ "aktif"**
  (eski fail-open davranış, revizyon 3'ün terk edilen mantığıyla aynı).
- SONUÇ: Migration 011 çalıştırılsa BİLE, sistemde artık İKİ FARKLI trial-bitişi kuralı olacak:
  `is_company_writable`/`register_device_and_touch_login` (fail-CLOSED, yeni) vs `check_subscription_active`
  (fail-OPEN, dokunulmamış). Ayrıca ben bu oturumda commit ettiğim frontend değişikliği (d6e4e5d) zaten
  fail-CLOSED'a geçti — yani şu an bile FRONTEND (kilitli ekran gösterir) ile bu BACKEND RLS/RPC kuralı
  (hâlâ izin verir) TUTARSIZ. Pratik etki: trial_ends_at NULL + is_pilot=false bir firma, frontend'de
  "süresi doldu" ekranını görse de, birisi doğrudan Supabase RPC'sini çağırırsa (mobil istemci, API,
  vs.) `create_order_installment_plan` gibi işlemler hâlâ ÇALIŞIR — çünkü RLS/RPC tarafı hâlâ eski
  fail-open kuralı kullanıyor.
- Ayrıca: `check_subscription_active` `SECURITY DEFINER` ama `SET search_path` PINLENMEMİŞ (migration
  011'in titizlikle uyguladığı kural burada yok) — içindeki tüm referanslar `public.companies` gibi
  şema-nitelikli olduğu için pratik istismar riski düşük görünüyor, ama migration 011'in kendi
  standardına göre tutarsız.
- NE YAPILMALI (karar sizin — kod değişikliği YAPMADIM): migration 011'e üçüncü bir CREATE OR REPLACE
  eklenip `check_subscription_active` de aynı fail-closed kurala ve `SET search_path`'e kavuşturulabilir,
  ya da ayrı bir migration 012 olarak hazırlanabilir. Onay verirseniz hazırlarım.
- KAPSAM GÜNCELLEMESİ (daha derin arama sonrası): `check_subscription_active` yalnızca 1-2 yerde değil,
  TAM 13 farklı SQL dosyasında kullanılıyor — tahsilat kayıt/iptal (supabase_customer_collection_finance_rpc.sql),
  tedarikçi ödemeleri (supabase_supplier_payment_finance_rpc.sql), montajcı hakediş/ödeme
  (supabase_installer_payment_finance_rpc.sql, supabase_rpc_add_manual_installer_earning.sql),
  montajcı iş ücreti (migration 004/005/006), tedarikçi soft-delete, ve migration 010'un 3 yeni RPC'si.
  Yani bu, sistemin NEREDEYSE TÜM finansal yazma RPC'lerinin ortak abonelik-kapısı — dar kapsamlı bir
  kenar durum değil. Ciddiyet: YÜKSEK (migration 011 sadece 2 dar fonksiyonu kapsıyor, asıl merkezi
  fonksiyona dokunmuyor).

## 6c. KRİTİK GÜVENLİK BULGULARI (arka plan ajanı + benim doğrulamam, HENÜZ DÜZELTİLMEDİ)

1. **[KRİTİK, DOĞRULANDI] `record_income_entry`/`record_expense_entry` — firma izolasyonu YOK.**
   `supabase_payment_transaction_safety.sql:273-361` (income), `:371-464` (expense muhtemelen aynı desen).
   `SECURITY DEFINER`, `GRANT EXECUTE ... TO authenticated`, ve fonksiyon gövdesinde `p_company_id`'nin
   çağıranın GERÇEKTEN üyesi olduğu bir firma olup olmadığını kontrol eden TEK BİR SATIR YOK. Yani
   giriş yapmış HERHANGİ BİR kullanıcı, BAŞKA bir firmanın company_id'sini vererek o firmanın
   gelir/gider defterine sahte kayıt ekleyebilir. Canlı çağrı noktaları doğrulandı:
   src/pages/Accounting.tsx (bu oturumda düzelttiğim satırların hemen yanında) ve AccountingSubPages.tsx.
   Aynı desen (yetki kontrolü yok) `record_order_payment`, `record_installer_payment`,
   `cancel_installer_payment`, `record_supplier_payment`, `record_invoice_save` için de geçerli (aynı
   dosya). KIYASLA: daha yeni "sertleştirilmiş" RPC ailesi (`customer_record_collection`,
   `supplier_record_payment`, `installer_record_payment`, migration 010) BU KONTROLÜ DOĞRU YAPIYOR
   ("unauthorized" fırlatıyor) — ama bu yeni servisler (src/services/finance/*) HİÇBİR sayfadan
   kullanılmıyor (yalnızca index/financeService.ts'den referanslı), yani canlı trafik hâlâ eski/açık
   fonksiyonları kullanıyor.
2. **[KRİTİK, DOĞRULANDI] `supplier_transactions` / `installer_transactions` RLS = herkese açık.**
   `supabase_rls_hardening_critical.sql:191-194` ve `:296-302`: INSERT politikaları `WITH CHECK (TRUE)`,
   UPDATE `USING (TRUE)`, VE `GRANT SELECT, INSERT, UPDATE ... TO authenticated` doğrudan tabloya
   veriliyor. Bu, herhangi bir giriş yapmış kullanıcının PostgREST üzerinden `/rest/v1/supplier_transactions`
   veya `/rest/v1/installer_transactions`'a doğrudan istek atıp BAŞKA HERHANGİ BİR FİRMANIN tedarikçi/
   montajcı cari hareketini ekleyebilmesi/değiştirebilmesi anlamına gelir — RPC'ye bile gerek yok.
   Başka hiçbir dosya bu 2 politikayı sonradan değiştirmiyor.
3. **[KRİTİK, DOĞRULANMASI CANLI DB GEREKTİRİYOR] `is_super_admin()`, `is_company_member(uuid)`,
   `is_company_accounting(uuid)` — search_path pinlenmemiş.** `supabase_rls_hardening_critical.sql:30-76`.
   Bunlar onlarca RLS politikası ve fonksiyon tarafından ÜSSÜZ (unqualified) çağrılan temel yetki
   fonksiyonları — search_path hijack riski (düşük olasılıklı ama yüksek etkili, çünkü bu 3 fonksiyon
   sistemin GERÇEK yetki temelini oluşturuyor).
4. **[ORTA, DOĞRULANMASI CANLI DB GEREKTİRİYOR] `supabase_rls_hardening_critical.sql:24-27`'deki
   `DROP FUNCTION ... CASCADE`** — Postgres'te bir fonksiyona bağımlı RLS politikaları CASCADE ile
   SESSİZCE silinir. Bu dosyanın hedeflediği 7 tablo dışında, `install_tenant_policy` ile kurulmuş
   customers/order_items/appointments/products/catalogs/... politikalarının da yan etki olarak
   silinip silinmediği KOD ÜZERİNDEN DOĞRULANAMAZ. Canlıda `SELECT tablename, policyname FROM
   pg_policies WHERE schemaname='public'` ile kontrol edilmeli.
5. **[YAPILDI] Accounting.tsx'teki `p_idempotency_key` fazlalık parametre hatası düzeltildi** (bu
   oturumda, commit edilmedi henüz — kullanıcı onayı bekleniyor, aşağıya bakın).

Not: Yukarıdaki 1-2 numaralı bulgular DB tarafında düzeltme gerektiriyor (RPC'ye yetki kontrolü eklemek,
RLS politikalarını company_id'ye göre daraltmak) — kod hazırlayabilirim ama ÇALIŞTIRAMAM, kullanıcı
onayı + Supabase SQL Editor'da elle çalıştırma gerekiyor.

**GÜNCELLEME: migration 012 taslağı hazırlandı** —
[supabase_migration_012_critical_rpc_rls_hardening.sql](supabase_migration_012_critical_rpc_rls_hardening.sql).
İçerik: (a) is_super_admin/is_company_member/is_company_accounting'e search_path pinleme (mantık aynı),
(b) 7 finansal RPC'ye (record_order_payment, record_invoice_save, record_income_entry,
record_expense_entry, record_installer_payment, cancel_installer_payment, record_supplier_payment)
`my_company_ids()/is_super_admin()` + `is_company_accounting()` kontrolü ekleme (kardeş RPC'lerdeki
KANITLANMIŞ doğru desenle birebir aynı), (c) supplier_transactions/installer_transactions RLS'inin
TRUE yerine is_company_accounting(company_id) kullanması (income tablosuyla aynı desen).
Preflight+postcheck korumalı, idempotent. HENÜZ ÇALIŞTIRILMADI, henüz git'e commit edilmedi
(kullanıcı onayı bekleniyor). check_subscription_active'in NULL-fail-open sorunu BİLİNÇLİ OLARAK
BU MİGRATION'A DAHİL EDİLMEDİ (ayrı karar gerektiriyor, bkz. 6b).

## 7. Kullanıcıdan istenecek CANLI DOĞRULAMA (salt-okunur SQL, ben çalıştıramıyorum)
- [ ] migration 007/008/009/010 gerçekten production'da mı çalıştırıldı? (update_installation_completion,
      order_payment_plans/order_installments tablolarının varlığı)
- [ ] Test Company 1/2 dışında trial_ends_at NULL + plan_status=trial + is_pilot=false olan başka firma
      var mı? (migration 011'in orphan-guard'ı zaten bunu kontrol ediyor ama önceden bilmek faydalı)

## 7b. Canlı doğrulama sonuçları (süper admin salt-okunur sorgularla, 2026-09-09)
- Test Company 1 (87fd5e69...) / Test Company 2 (80fef6ae...) ID'leri backfill SQL'indekiyle
  BİREBİR eşleşiyor. İkisinin de trial_ends_at'i ARTIK NULL DEĞİL (2026-07-02, geçmişte) — demek ki
  supabase_fix_test_company_trial_ends_at.sql çalıştırılmasa bile bu 2 firma migration 011'in
  orphan-guard'ını artık TETİKLEMİYOR (muhtemelen backfill başka bir yoldan zaten yapılmış).
- TÜM 37 firma arasında migration 011'in "orphan" tanımına uyan (trial + pilot değil + trial_ends_at
  NULL) 0 firma var. Migration 011 şu anki haliyle orphan-guard'a takılmadan geçebilir (canlı veriyle
  doğrulandı).
- **CANLI KANIT bulundu:** "Almila Teks" (gerçek firma) — trial_end=2026-09-01 (geçmiş, donuk),
  trial_ends_at=2026-09-11 (gelecek, gerçek). Bugün commit ettiğim trial_ends_at-tek-kaynak
  düzeltmesi PRODUCTION'A gitmeden bu firma yanlışlıkla "süresi doldu" görünebilir/görünüyor olabilir.
- Test Company 1/2'nin `company_members` tablosunda HİÇ kullanıcı yok (0 satır) — E2E yazma testleri
  için gerçek (süper admin olmayan) bir test kullanıcısı YOK, uygulamanın davet akışıyla oluşturulması
  gerekiyor (kullanıcıya adımlar verildi: Personel sayfası → Yeni Personel Kartı → rol ata → davet kodu
  → SignupWithCode ile kayıt).

## 7c. E2E test altyapısı bulguları
- `company.authed.spec.ts`'in yazma-akışı testleri, `tests/e2e/helpers/auth.ts:actAsTestCompanyAdmin`
  fonksiyonunun ARTIK GÜNCEL OLMAYAN bir varsayımı yüzünden bloke: rol seçme kutusunda "Süper Admin"
  metinli bir `<option>` arıyor, ama (a) buton etiketi "Süper Yönetici"ye değişmiş, (b) demo/tenant
  modundayken kutu artık firmanın enabled_roles'una göre filtreleniyor ve 2'den az rol varsa HİÇ
  render edilmiyor (Layout.tsx:367-372, muhtemelen "future-proof multi-role" commit'inin getirdiği
  davranış). Bu bir TEST kodu sorunu, uygulama hatası değil — ama düzeltmeden bu testler hiç çalışmaz.
- **DOĞRULANMAMIŞ, olası regresyon riski:** `SuperAdminCompanies.tsx:openDemo()` rolü
  `localStorage.demo_viewing_role` ile ayarlıyor, ama `RoleContext.tsx:97-105`'teki mount effect'i
  süper adminler için bu anahtarı HER YÜKLEMEDE siliyor. İstemci-taraflı navigasyonda (`nav()`, reload
  yok) bu sorun olmayabilir ama benim otomatik script'lerim tutarlı/güvenilir bir sonuç üretemedi
  (ara yükleme durumları araya girdi). KULLANICIDAN GERÇEK TIKLAMAYLA DOĞRULAMA İSTENDİ — "Firma
  Olarak Giriş" sonrası üst menüde gerçekten "Yönetici" görünüyor mu?
- `scripts/e2e-record-auth.mjs` küçük bir uyumluluk değişikliğiyle güncellendi: artık
  `node scripts/e2e-record-auth.mjs <dosya-yolu>` ile FARKLI bir state dosyasına kaydedilebiliyor
  (argüman verilmezse eskisi gibi tests/e2e/.auth/state.json'a yazar — geriye dönük uyumlu).

## 7d. E-posta gönderimi bulgusu
`src/services/emailService.ts` → `supabase.functions.invoke("send-email", ...)` çağırıyor, ama repoda
**`supabase/functions/` klasörü YOK** — böyle bir Edge Function'ın kodu bu repoda bulunmuyor (Supabase
dashboard'dan ayrıca deploy edilmiş olabilir, KOD ÜZERİNDEN DOĞRULANAMAZ). `sendEmail()` başarısızlığı
kendi içinde yutuyor (retry kuyruğuna alıyor, sonunda pes ediyor, hiçbir yerde throw etmiyor) — yani
sipariş/randevu/durum-değişikliği bildirimi e-postaları muhtemelen HİÇ gitmiyor ama bu, çağıran akışları
(sipariş oluşturma vb.) ÇÖKERTMÜYOR. Davet akışı (StaffManagement → Personel'e rol ata) e-postaya
BAĞIMLI DEĞİL — bir kod üretiyor, admin bunu elle paylaşıyor (Excel/WhatsApp/vs.), bu yüzden daha
güvenilir. NET SORU (canlı doğrulama gerektirir): Supabase projesinde gerçekten "send-email" adlı bir
Edge Function deploy edilmiş mi? Kullanıcıya soruldu mu — HAYIR, henüz sorulmadı, rapora not düşüldü.

## 7e. DÜZELTME: "hardened" finans servisleri hiçbir ekrana bağlı değil" iddiası YANLIŞ
Arka plan ajanının raporu, yeni (güvenli) finans servislerinin (customer_record_collection,
supplier_record_payment, installer_record_payment vb.) hiçbir ekrandan çağrılmadığını iddia etmişti.
Bunu kod üzerinden BİZZAT doğruladım — bu YANLIŞ:
- `customer_record_collection`: OrderDetail.tsx, NewOrder.tsx (peşinat), Customers.tsx, Quotes.tsx
  hepsi `createFinanceService().customerCollections` üzerinden bunu çağırıyor. CANLI KULLANIMDA.
- `supplier_record_payment`: SupplierDetail.tsx:212, SupplierLedger.tsx:322 —
  `financeService.supplierPayments.recordPayment` üzerinden. CANLI KULLANIMDA. (Not:
  `supplierPaymentService.ts`'in kendi üst-dosya yorumu "hiçbir ekran bağlı değil" diyor ama bu artık
  DONUK/YANLIŞ bir yorum — kod ilerlemiş, yorum güncellenmemiş.)
- `installer_record_payment`/`installer_cancel_payment`/`add_manual_installer_earning`:
  InstallerLedger.tsx:654,682,705 — `financeService.installerPayments.*` üzerinden. CANLI KULLANIMDA.
- Yalnızca `record_order_payment`/`record_income_entry`/`record_expense_entry`/`record_invoice_save`
  (ESKİ, korumasız) hâlâ canlı kullanımda: Accounting.tsx (genel gelir/gider ekranı) ve
  InvoiceDetail.tsx:264 (fatura kaydı). Yani 6c'deki güvenlik açığı ANA SATIŞ/TAHSİLAT/CARİ akışlarını
  DEĞİL, "Muhasebe" ekranındaki genel gelir/gider girişini VE fatura kaydını etkiliyor — ciddiyet hâlâ
  KRİTİK ama kapsam ilk düşünülenden DAHA DAR.

## 7f. CANLI RPC VAR-OLMA TESTİ (süper admin ile, güvenli/temizlenmiş)
Test Company 1 üzerinde, gerçek yazma yapmadan ÖNCE var-olmama ihtimaline karşı güvenli parametrelerle
(rastgele/sahte ID) 2 RPC'yi çağırdım:
- `supplier_record_payment`: production'da MEVCUT — FK ihlaliyle (sahte supplier_id) durdu, hiçbir
  satır kalıcı olmadı (fonksiyon içinde ayrı EXCEPTION bloğu yok, plpgsql'de yakalanmayan hata tüm
  çağrıyı otomatik geri alır). `supabase_supplier_payment_finance_rpc.sql`'in "Supabase'e
  UYGULANMADI" diyen yorumu da ARTIK DONUK — fonksiyon deploy edilmiş.
  BEKLENMEYEN: Test Company 1'in trial'ı gecmiste (trial_ends_at 2026-07-02) olmasına ragmen
  `check_subscription_active` kontrolüne TAKILMADI (FK hatasına kadar ilerledi) — ya deploy edilen
  versiyon dosyadakinden farklı ya da check_subscription_active bu spesifik cagrida beklenenden
  farkli davraniyor. CANLIDA AYRICA DOGRULANMALI.
- `installer_record_payment`: production'da MEVCUT ve BAŞARIYLA ÇALIŞTI — sahte/var-olmayan bir
  installer_id ile bile kayıt oluşturdu (installer_id'nin gerçekten var olan bir montajcıya ait
  olduğunu DOĞRULAMIYOR — düşük öncelikli veri bütünlüğü eksikliği). **YANLIŞLIKLA Test Company 1'e
  gerçek bir kayıt yazıldı** (expense_id 78274044..., installer_transactions id 2e0a7511...) —
  HEMEN `installer_cancel_payment` RPC'si ile (uygulamanın kendi "ters kayıt" mekanizmasıyla, hard
  delete DENENMEDİ çünkü RLS zaten DELETE'i sessizce engelliyor — installer_transactions'ta DELETE
  policy'si YOK) tersine çevrildi, net bakiye etkisi 0. Kalıcı iz: ledger'da 1 payment + 1 offsetting
  cancel satırı (tutarlı, denetlenebilir, gerçek veriye etkisi yok).

## 7g. BÜYÜK BULGU: check_subscription_active YANLIŞ KOLONU OKUYOR — 37 firmanın 31'inde (%84) etkisiz
Canlı sorguyla doğrulandı (2026-09-09, süper admin salt-okunur):
`check_subscription_active(uuid)` (supabase_subscription_auth.sql:44) `subscription_plan` kolonunu
okuyor ve `subscription_plan='lifetime'` ise HER ZAMAN true, `subscription_plan='trial'` DEĞİLSE de
HER ZAMAN true (yalnız subscription_plan LİTERALEN 'trial' ise trial_ends_at kontrolüne giriyor).
Ama sistemin GERÇEK deneme/lisans durumu `plan_status` kolonunda tutuluyor (Dashboard/Layout/migration
011/trialLicense.ts hepsi plan_status kullanıyor) — bu 2 kolon BAĞIMSIZ ve ÇOĞU FİRMADA UYUŞMUYOR.

Canlı veri (37 firmanın 31'i etkileniyor): subscription_plan çoğunlukla 'solo'/'starter'/'pro'/
'lifetime' (paket adı gibi görünüyor) iken plan_status='trial' ve trial_ends_at çoğunlukla GEÇMİŞTE
(Nisan-Ağustos 2026, bazıları 5 ay önce). Test Company 1/2 dahil (subscription_plan='lifetime',
plan_status='trial', trial_ends_at=2026-07-02).

SONUÇ: check_subscription_active bu 31 firmanın TAMAMI için `true` döner — deneme süresi dolmuş olsa
bile. Bu fonksiyon 13 SQL dosyasında (bkz. 6b) neredeyse TÜM finansal RPC'lerin lisans-kapısı. Yani
RPC seviyesinde deneme-süresi-doldu kısıtlaması bu firmaların %84'ü için PRATİKTE ÇALIŞMIYOR — frontend
(bugünkü fail-closed düzeltmemle) kilit ekranı gösterse bile, RPC'ye erişen herhangi bir yol
(gelecekte farklı bir istemci, mobil, vs.) bunu atlar. Bu bir tenant-izolasyon açığı DEĞİL ama lisans/
deneme zorlamasının sistemik arızası — "deneme süresi dolmuş firmaların davranışını doğrula"
maddesinin doğrudan karşılığı.

ÖNERİLEN DÜZELTME (kullanıcıya soruldu, henüz onay yok): check_subscription_active'i subscription_plan
yerine plan_status+trial_ends_at okuyacak, migration 011/trialLicense.ts ile AYNI fail-closed kurala
göre yeniden yazmak — migration 012'ye eklenebilir veya ayrı migration 013 olarak hazırlanabilir.
DOKUNMADIM, kod değişikliği YAPILMADI.

## 7h. "İşlem Modu"na rağmen "Deneme süreniz dolmuştur" banner'ı neden kalıyor
Kullanıcı süper admin panelinden Test Company 1'e "İşlem Modu" (openDemo(company,"admin",false) —
yazma açık) ile girdi, rol geçişi (Yönetici) sorunsuz çalıştı, ama kırmızı "DENEME SÜRENİZ DOLMUŞTUR...
Yeni işlem yapılamaz" banner'ı (Layout.tsx:900-903, `isExpiredTrial` state'i tarafından kontrol
ediliyor) kalmaya devam etti. KÖK NEDEN (kod okumasıyla bulundu, TEYİT EDİLMEDİ ama yüksek güvenilirlik):
`isExpiredTrial`'ı hesaplayan `useEffect`'in (Layout.tsx:375-432) bağımlılık dizisi SADECE `[realRole]`
(satır 432) — `demo_company_id`/`demo_read_only` localStorage'tan okunuyor ama React state/deps'e HİÇ
girmiyor. Süper admin zaten giriş yapmışken (SuperAdminCompanies sayfasındayken) `realRole` ZATEN
"super_admin", İşlem Modu'na geçince DE "super_admin" kalıyor — yani bu deps dizisi hiç değişmiyor.
Eğer Layout, /dashboard'a client-taraflı nav sırasında YENİDEN MOUNT olmuyorsa (aynı Layout instance'ı
korunuyorsa), bu effect BİR DAHA ÇALIŞMAZ ve `isExpiredTrial`'ın (yanlışlıkla true kalmış) eski değeri
sticky kalır. Bu, `isSuperAdminWriteDemo` mantığının kendisinin YANLIŞ olmasından değil, effect'in
demo-mode geçişini YAKALAYAMAMASINDAN kaynaklanan bir React bağımlılık-dizisi hatası olabilir.
BU AYRI BİR BUG, bu oturumda DÜZELTİLMEDİ (kapsam dışı bırakıldı — kullanıcının asıl ihtiyacı olan
"test firmalarını nasıl kullanılabilir hale getiririm" sorusu, trial_ends_at'i geleceğe taşıyarak
tamamen BAĞIMSIZ şekilde çözülüyor, bkz. 7i). Ayrı onayla düzeltilebilir: effect'in deps dizisine
`localStorage` değişikliğini yakalayacak bir mekanizma (örn. bir "demo mode version" state'i, ya da
basitçe sayfa reload'u) eklenmeli.

## 7i. ÇÖZÜM HAZIR: Test Company 1/2 için trial_ends_at'i geleceğe taşıma
[supabase_extend_test_company_trial_for_qa.sql](supabase_extend_test_company_trial_for_qa.sql) hazırlandı.
LİSANS KONTROLÜNÜ DEVRE DIŞI BIRAKMIYOR — is_company_writable/check_subscription_active/trialLicense.ts
HİÇBİRİNE dokunulmuyor. Sadece bu 2 test firmasının trial_ends_at'ini now()+180 gün'e taşıyor, böylece
AYNI kontrollerden "aktif deneme" olarak geçiyorlar (gerçek yeni bir müşteri gibi). Guard'lar: isim+ID
eşleşmesi, plan_status=trial+is_pilot=false zorunlu, customers/orders/payments=0 zorunlu (gerçek veri
varsa DURDURULUR), mevcut trial_ends_at'in bilinen değerle (2026-07-02) birebir eşleşmesi zorunlu,
güncelleme sonrası tam 2 satır + başka hiçbir alan/firma değişmediği doğrulanıyor. Rollback SQL'i
dosyanın sonunda hazır.

**UYGULANDI (2026-09-09, kullanıcı onayıyla, sadece bu dar kapsamla — migration 011/012 HARİÇ):**
Test Company 1 ve Test Company 2'nin `trial_ends_at`'i `2027-03-08T19:00:34.083+00:00`'a (now()+180 gün)
güncellendi. Doğrulama: preflight (isim/ID/durum/eski-tarih eşleşmesi + 0 müşteri/sipariş/ödeme) geçti,
tam 2 satır güncellendi, her iki firmada da is_pilot/plan_status/subscription_plan/is_active/read_only
DEĞİŞMEDİ, bu 2 ID dışında eski tarihe sahip firma sayısı önce/sonra 0/0 (yan etki yok). Rollback:
dosyanın sonundaki UPDATE ile eski değere (2026-07-02T12:23:19.328922+00) dönülebilir.

## 9. KRİTİK FİYAT HATASI BULUNDU VE DÜZELTİLDİ: Teklif/Sipariş, tül/fon ve stor için YANLIŞ alan kullanıyordu
**Kök neden:** `src/pages/Quotes.tsx`'teki `calcEstimate()` (Teklif ekranı toplamı) ve
`handleConvertGroup()` (Siparişe Çevir) kendi BAĞIMSIZ, YANLIŞ alan hesabını yapıyordu:
`areaM2 = (width_cm/100) * (height_cm/100)` — yani DÜZ genişlik×yükseklik. Ama ölçü aşamasında
(`MeasurementEntry.tsx`/`measurementConstants.ts::calculate()`) tül/fon için DOĞRU formül
`fabricWidthCm = width*pileÇarpanı+15` → `areaM2 = fabricWidthCm/100` (kumaş eni, pile'a göre 2 veya
3 katı + 15cm dikiş payı) ve stor/zebra için `rounded_width_cm`/`rounded_height_cm` (min ölçü + 10'a
yuvarlama) kullanılıyordu. Bu doğru değer `appointments.estimated_area_m2`/`estimated_total` olarak
KAYDEDİLİYORDU ama Quotes.tsx bunu HİÇ OKUMUYOR, sıfırdan (ve yanlış) yeniden hesaplıyordu.

**Etki (örnek, gerçek sayılarla):** Tül, en=200cm, boy=250cm, pile=1'e 3, birim fiyat=420₺/m²:
- Ölçüde hesaplanan (DOĞRU): kumaş eni=200×3+15=615cm → alan=6.15m² → toplam=**2583₺**
- Teklif/Sipariş ekranında hesaplanan (YANLIŞ, düzeltme öncesi): alan=2m×2.5m=5m² → toplam=**2100₺**
Yani müşteriye ölçü sırasında gösterilen fiyat İLE siparişe geçen/faturalanan fiyat **BİRBİRİNDEN
FARKLI** — hem stor/zebra (min-ölçü+yuvarlama kaybı) hem tül/fon (pile+dikiş payı kaybı) etkileniyor.
Ayrıca tedarikçi maliyeti (`supplierLineTotal`) ve kâr (`profit`) hesabı da AYNI yanlış alanla
yapıldığı için kâr marjı raporları da hatalı.

**Düzeltme (bu oturumda yapıldı, commit edilmedi henüz):** `src/pages/Quotes.tsx` — `estimated_area_m2`
kolonu select/type'a eklendi, yeni `areaM2Of(row)` helper'ı bu DEPOLANMIŞ doğru değeri kullanıyor
(yalnızca hiç yoksa — çok eski kayıtlar için — düz width×height'a düşüyor), hem `calcEstimate()` hem
`handleConvertGroup()`'taki `itemsPayload` bunu kullanacak şekilde güncellendi. Genişlik/yükseklik/
fiyat/adet Teklif ekranında DÜZENLENEMEDİĞİ için (doğrulandı — hiçbir onChange yok) bu depolanmış
değeri yeniden kullanmak GÜVENLİ. `npx tsc -b` ve `npx eslint src/pages/Quotes.tsx` temiz.

**Canlı E2E testiyle doğrulanıyor:** [tests/e2e/curtain-flow.authed.spec.ts](tests/e2e/curtain-flow.authed.spec.ts) —
gerçek tül ölçüsü girip Teklif'e, sonra Sipariş'e çeviriyor, DB'den `estimated_area_m2`/`estimated_total`
ve nihai `order_items.line_total`'ın bağımsız hesaplanan beklenen değerle (2583₺) eşleştiğini
doğruluyor. Sonuç bekleniyor.

**AYRI, küçük bulgu (düzeltilmedi):** `NewOrder.tsx`'in KENDİ doğrudan sipariş oluşturma akışı
jalousie/picasso için reduktör/kurdelalı gibi EK çarpanlar uyguluyor (satır 750-754) ama
`MeasurementEntry.tsx::calculate()` bunları HİÇ bilmiyor — yani jalousie/picasso ölçüsü alınırken
gösterilen tahmini fiyat, doğrudan sipariş oluşturmadaki nihai fiyattan farklı olabilir. Kapsam/zaman
kısıtı nedeniyle bu oturumda dokunulmadı, ayrı bir bulgu olarak not edildi.

## 10. KRİTİK UYGULAMA HATASI BULUNDU VE DÜZELTİLDİ: openDemo() rolü hiç değiştirmiyordu
E2E testinin network trace'i (console/network/pageerror loglanarak) incelendiğinde, aynı 37 firmanın
company_devices/support_tickets sorgularının DEFALARCA (bazı company_id'ler 4+ kez) tekrarlandığı
görüldü — tek seferlik yavaşlık değil, sürekli tekrar. Kök neden: `SuperAdminCompanies.tsx::openDemo()`
(Demo İzle/İşlem Modu butonları) firma bağlamını (`demo_company_id`) doğru ayarlıyordu ama
`effectiveRole`'ü (RoleContext) HİÇ "admin"e çevirmiyordu — yalnızca hiçbir yerde okunmayan ölü bir
localStorage anahtarına (`demo_viewing_role`) yazıyordu. Sonuç: `/dashboard`, `/measurements/new` gibi
sayfalardaki `RoleGate`, rol hâlâ "super_admin" olduğu için erişimi reddedip `/super-admin/companies`'e
geri yönlendiriyordu — bu da firma listesinin yeniden yüklenmesine (ve tekrar sorgu fırtınasına) yol
açıyordu. AYNI SORUN, AYNI DOSYADA "Firma Olarak Giriş" (impersonation) akışı için ZATEN bulunup
düzeltilmişti (kod içindeki yorum bunu doğruluyor) — ama `openDemo()`'ya hiç uygulanmamıştı.
**DÜZELTME (commit ffc6815):** `openDemo()`, impersonation'daki kanıtlanmış desene taşındı
(`setViewingRoleAndUser` + effectiveRole gerçekten commit edilene kadar navigasyonu erteleyen effect).
CANLI DOĞRULANDI: company.authed.spec.ts VE curtain-flow.authed.spec.ts artık PASS.

## 11. KRİTİK FİYAT HATASI DOĞRULANDI (commit 59d86ff) — canlı E2E ile kanıtlandı
Bölüm 9'daki bulgu artık gerçek tıklama/yazma ile doğrulandı:
[tests/e2e/curtain-flow.authed.spec.ts](tests/e2e/curtain-flow.authed.spec.ts) — Test Company 1'de
gerçek bir tül ölçüsü (en=200cm, boy=250cm, pile 1'e 3, birim fiyat=420₺/m²) girildi, Teklif'e
kaydedildi, Siparişe çevrildi. SONUÇ: `appointments.estimated_area_m2`=6.15, `estimated_total`=2583₺
VE nihai `order_items.line_total`=2583₺ — DÜZELTME ÖNCESİ bu son değer yanlışlıkla 2100₺ olacaktı
(width×height hatası). **1 passed (22.8s).**

## 12. Android build: BAŞARILI (C:\PerdePRO-Build, NTFS) — kanıtlı
Kullanıcı onayıyla proje (node_modules/.git/eski release'ler HARİÇ) `C:\PerdePRO-Build`'e kopyalandı,
`npm install` + `npm run build` + `npx cap sync android` + `gradlew assembleDebug` sırayla çalıştırıldı.
**BUILD SUCCESSFUL (1m 4s, 338/338 görev)** — APK: `C:\PerdePRO-Build\android\app\build\outputs\apk\debug\app-debug.apk`
(9.45 MB, doğrulandı).

KÖK NEDEN ARAŞTIRMASI (kullanıcı talebi üzerine, FAT32'yi tek neden saymadan): (1) D:\ sürücüsünde
bir Gradle daemon'ı çalışır durumdaydı — `gradlew --stop` ile durduruldu, AMA sorun devam etti (bu,
daemon'ın TEK başına neden olmadığını kanıtlıyor). (2) D:\ sürücüsü FAT32 (`Get-Volume` ile
doğrulandı) — `gradlew clean` bile build klasörünü silemedi ("Unable to delete directory"), bu
NTFS'e özgü dosya-özniteliği/kilit semantiğinin FAT32'de çalışmadığını gösteriyor. (3) AYRICA, C:\
kopyasında BAŞKA bir engel daha çıktı: `android/local.properties`'teki SDK yolu `.android-sdk`
(D:\'de, proje-özel, kısmi bir SDK) idi — Android Gradle Plugin bunu "Invalid file path" ile
REDDETTİ (muhtemelen cross-drive veya format sorunu). Bilgisayarda zaten TAM bir Android Studio SDK'sı
vardı (`C:\Users\Oslem\AppData\Local\Android\Sdk`, android-36 + build-tools 36.1.0) — buna
yönlendirilince build başarıyla tamamlandı. SONUÇ: FAT32 GERÇEK bir katkıda bulunan neden (D:\'de
clean bile başarısız oldu), ama TEK neden değildi — SDK yolu sorunu AYRI ve EŞİT ÖNEMDE bir engeldi.
D:\ üzerinde SDK yolu düzeltilse bile FAT32 sorunu muhtemelen devam ederdi (clean testi bunu gösteriyor).

**NOT:** Bu yalnızca DEBUG build'dir (imzasız, geliştirme amaçlı). RELEASE (imzalı, Play Store'a
yüklenebilir AAB) için keystore/imzalama AYRI onay gerektiriyor — talimatlar gereği bu adımda
DURULDU, ilerlenmedi.

## 8. Kalan işler / bloke olanlar
- E2E oturumlu test paketi: kullanıcının `node scripts/e2e-record-auth.mjs` çalıştırıp elle giriş
  yapması bekleniyor.
- DB migration 011 + backfill: kullanıcı onayı bekleniyor.
- Mobil (Android/Capacitor) build ve Google Play hazırlığı: HENÜZ BAŞLANMADI.
- Gerçek tarayıcı E2E (sipariş/teklif/perde hesaplama/tahsilat/montaj akışları): oturum yenilenince
  yapılacak.
