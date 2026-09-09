# Migration 012 & 013 — İnceleme Dokümanı

**Bu belge bir uygulama onayı değildir.** Yalnızca inceleme amaçlıdır. Hiçbir SQL çalıştırılmadı.

İlgili dosyalar:
- [supabase_migration_012_critical_rpc_rls_hardening.sql](supabase_migration_012_critical_rpc_rls_hardening.sql) (445 satır)
- [supabase_migration_013_check_subscription_active_fix.sql](supabase_migration_013_check_subscription_active_fix.sql) (195 satır)

Not: **Migration 011 de hâlâ uygulanmadı** (aynı onay bekleme durumunda) — 012/013 onunla ilişkili ama BAĞIMSIZ, ayrı ayrı da uygulanabilir.

---

## Migration 012 — Finansal RPC yetki kontrolü + RLS sıkılaştırma

### Ne değiştiriyor (3 parça)

**1) 3 temel yetki fonksiyonuna `search_path` pinleme**
`is_super_admin()`, `is_company_member(uuid)`, `is_company_accounting(uuid)` — mantık BİREBİR AYNI kalıyor, yalnızca `SET search_path = public` ekleniyor.

| Fonksiyon | Canlı tanım (kaynak) | Migration 012 sonrası |
|---|---|---|
| `is_super_admin()` | `supabase_rls_hardening_critical.sql:30-35` — search_path YOK | Aynı gövde + `SET search_path = public` |
| `is_company_member(uuid)` | aynı dosya:37-46 — search_path YOK | Aynı gövde + `SET search_path = public` |
| `is_company_accounting(uuid)` | aynı dosya:63-76 — search_path YOK | Aynı gövde + `SET search_path = public` |

**2) 7 finansal RPC'ye firma-yetki kontrolü ekleme**
`record_order_payment`, `record_invoice_save`, `record_income_entry`, `record_expense_entry`, `record_installer_payment`, `cancel_installer_payment`, `record_supplier_payment` (hepsi `supabase_payment_transaction_safety.sql`).

**Canlı tanım (7'si için de aynı desen):** Fonksiyon gövdesinin başında **hiçbir yetki kontrolü yok** — `p_company_id`'nin çağıranın gerçekten üyesi olduğu bir firma olup olmadığı hiç sorgulanmıyor.

**Migration 012 sonrası (7'si için de eklenen, gövdenin başına):**
```sql
IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
END IF;
IF NOT public.is_company_accounting(p_company_id) THEN
    RAISE EXCEPTION 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
END IF;
```
Bu, zaten canlıda çalışan ve doğru yazılmış kardeş RPC'lerdeki (`customer_record_collection`, `supplier_record_payment`, `installer_record_payment` — migration 010/hardening RPC ailesi) AYNI desendir; yeni bir kural icat edilmiyor. **İş mantığının geri kalanı (parametreler, INSERT/UPDATE sırası, dönüş JSON'u, hata yakalama) HİÇ değişmiyor** — dosyayı satır satır karşılaştırırsanız yalnızca bu 2 IF bloğu + `SET search_path = public` eklendiğini göreceksiniz.

**3) 3 RLS politikasının TRUE yerine gerçek kontrol kullanması**

| Politika | Canlı tanım | Migration 012 sonrası |
|---|---|---|
| `installer_transactions_insert` | `supabase_rls_hardening_critical.sql:191-194` — `WITH CHECK (TRUE)` | `WITH CHECK (is_company_accounting(company_id))` |
| `supplier_transactions_insert` | aynı dosya:296-297 — `WITH CHECK (TRUE)` | `WITH CHECK (is_company_accounting(company_id))` |
| `supplier_transactions_update` | aynı dosya:299-300 — `USING (TRUE)` | `USING (is_company_accounting(company_id))` |

Bu, AYNI dosyadaki `income` tablosu için zaten kullanılan doğru desendir (`income_admin_insert`/`income_admin_update`, satır 149-157) — yeni bir kural değil, mevcut standardın 2 eksik tabloya uygulanması.

### Neye DOKUNMUYOR (bilinçli)
- `check_subscription_active()` — bu migration 013'te ayrı ele alınıyor.
- `update_installation_completion()` — migration 008'deki güncel hali zaten doğru, bu dosyada YENİDEN OLUŞTURULMUYOR.
- "Sertleştirilmiş" RPC ailesinin (customer_record_collection vb.) kendisi — zaten doğru, dokunulmuyor.

### Test durumu
- **Canlı olarak DOĞRUDAN test EDİLMEDİ** (uygulanmadığı için test edilemez).
- Dolaylı güven: değiştirilen 7 fonksiyonun aynı deseni, migration 010'daki (`create_order_installment_plan` vb.) VE `customer_record_collection`'ın ZATEN production'da çalışan, bu oturumda canlı E2E testiyle doğrulanmış (curtain-flow.authed.spec.ts, company.authed.spec.ts) hâliyle BİREBİR aynı — yani desenin kendisi kanıtlı, ama BU SPESİFİK 7 fonksiyona uygulanmış hâli canlıda hiç çalıştırılmadı.
- Uygulama sonrası önerilen regresyon: Test Company 1/2 ile normal gelir/gider/tahsilat/montajcı-ödemesi akışlarının ESKİSİ GİBİ çalıştığını doğrulamak + başka bir firmanın ID'siyle aynı RPC'yi çağırıp `unauthorized` hatası alındığını doğrulamak (migration dosyasının sonunda hazır sorgular var).

### Geri alma
- **Politikalar** (dosyanın kendi rollback notunda hazır SQL var, satır 66-71): `DROP POLICY` + `CREATE POLICY ... WITH CHECK (TRUE)` ile eski (güvensiz) hâline dönülebilir.
- **Fonksiyonlar**: `supabase_payment_transaction_safety.sql` dosyasını (orijinal, değiştirilmemiş hâliyle) yeniden çalıştırmak yeterli — bu dosya hâlâ repoda duruyor, fonksiyonların migration-öncesi tam gövdesini içeriyor. (Bu, güvenlik açığını GERİ GETİRİR — yalnızca migration 012'nin kendisinde beklenmedik bir sorun çıkarsa kullanılmalı.)

---

## Migration 013 — check_subscription_active() yanlış kolonu okuyor

### Ne değiştiriyor

| | Canlı tanım (`supabase_subscription_auth.sql:44-75`) | Migration 013 sonrası |
|---|---|---|
| Okuduğu kolonlar | `subscription_plan`, `trial_ends_at` | `plan_status`, `is_pilot`, `trial_ends_at` |
| `is_pilot=true` firma | Kontrol edilmiyor (dolaylı: subscription_plan'e bağlı) | HER ZAMAN `true` (muaf) |
| `plan_status IN ('active','lifetime')` | Kontrol edilmiyor | `true` (trial kontrolüne hiç girmez) |
| `plan_status IN ('expired','suspended')` | Kontrol edilmiyor | `false` |
| `plan_status='trial'`, `trial_ends_at` NULL | `subscription_plan≠'trial'` ise → `true` (YANLIŞ, fail-open) | `false` (fail-closed) |
| `plan_status='trial'`, `trial_ends_at` geçmişte | `subscription_plan='lifetime'` gibi bir değerdeyse → `true` (YANLIŞ) | `false` (doğru) |
| `search_path` | Pinlenmemiş | `SET search_path = public` |

**Canlı tanımın tam metni** (satır satır, `supabase_subscription_auth.sql:44-75`):
```sql
CREATE OR REPLACE FUNCTION public.check_subscription_active(company_uuid uuid)
RETURNS boolean AS $$
DECLARE
  v_plan TEXT;
  v_ends TIMESTAMP WITH TIME ZONE;
BEGIN
  IF company_uuid IS NULL THEN RETURN TRUE; END IF;
  SELECT subscription_plan, trial_ends_at INTO v_plan, v_ends
    FROM public.companies WHERE id = company_uuid;
  IF v_plan IS NULL THEN RETURN TRUE; END IF;
  IF v_plan = 'lifetime' THEN RETURN true; END IF;
  IF v_plan = 'trial' AND now() > v_ends THEN RETURN false; END IF;
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```
Tam migration 013 SQL'i için bkz. [dosyanın kendisi](supabase_migration_013_check_subscription_active_fix.sql) (satır 130-165).

### "31 firma etkileniyor" bulgusu — sorgu ve ölçüt (tekrar üretilebilir)

**Ölçüt:** `check_subscription_active()`'in canlı davranışına göre "yanlışlıkla aktif" sayılan firma = `subscription_plan` alanı **tam olarak** `'trial'` DEĞİL VE `plan_status` alanı `'trial'`/`'expired'`/`'suspended'`'dan biri (yani GERÇEKTE trial/expired/suspended durumda ama `subscription_plan` bunu yansıtmıyor).

```sql
select count(*) from public.companies
where subscription_plan is distinct from 'trial'
  and plan_status in ('trial','expired','suspended');
```
Detaylı liste için:
```sql
select id, name, subscription_plan, plan_status, trial_ends_at, is_active
from public.companies
where subscription_plan is distinct from 'trial'
  and plan_status in ('trial','expired','suspended')
order by trial_ends_at nulls first;
```
**2026-09-09 tarihli sonuç:** 37 firmanın 31'i (uygulamadan süper admin oturumuyla salt-okunur sorgulanarak doğrulandı — ham veri bu oturumda kaydedilmedi, yalnızca sayı ve birkaç örnek: Test Company 1/2, çoğu "PerdePRO" adlı deneme firması). **Bu sayı zamanla değişir** (yeni kayıtlar, süre dolan denemeler) — migration'ı çalıştırmadan hemen önce sorgu TEKRAR çalıştırılıp güncel sayı teyit edilmeli.

### Etki kapsamı — bu fonksiyonu kullanan 13 dosya/RPC ailesi
`record_income_entry`, `record_expense_entry`, `record_order_payment`, `record_invoice_save`, `record_installer_payment`, `cancel_installer_payment`, `record_supplier_payment` (migration 012'nin de dokunduğu 7'si — AMA migration 012 bu fonksiyonun KENDİSİNE değil, ÇAĞIRAN RPC'lere yetki kontrolü ekliyor, ikisi farklı katman), `customer_record_collection`/`cancel_collection`, `supplier_record_payment`/`cancel_payment`, `installer_record_payment`/`cancel_payment`/`add_manual_earning`, `create/rebuild/cancel_order_installment_plan` (migration 010).

**Migration 012 ile ilişkisi:** BAĞIMSIZ. 012, "çağıran firmanın gerçek sahibi mi" sorusunu çözüyor. 013, "bu firmanın lisansı/denemesi hâlâ geçerli mi" sorusunu çözüyor. İkisi de AYNI RPC ailesinin İÇİNDE ayrı ayrı kontrol satırları — biri diğerini geçersiz kılmıyor, ikisi de gerekli. 012 uygulanıp 013 uygulanmazsa: yetki kontrolü doğru çalışır ama süresi dolmuş firmalar hâlâ işlem yapabilir. 013 uygulanıp 012 uygulanmazsa: süre kontrolü doğru çalışır ama başka bir firmanın ID'siyle çağıran biri hâlâ yazabilir.

### Test durumu
- **Canlı olarak DOĞRUDAN test EDİLMEDİ.**
- Bulgunun kendisi (yanlış kolon okuma) canlı RPC çağrısıyla DOĞRULANDI: `check_subscription_active('87fd5e69-...')` (Test Company 1, o an trial_ends_at geçmişteydi) → `true` döndü, davranış dosyadaki mantıkla BİREBİR eşleşti (subscription_plan='lifetime' olduğu için).
- Uygulama sonrası önerilen regresyon: aktif ücretli firmalarda hiçbir davranış değişikliği olmadığını, gerçekten süresi dolmuş firmalarda artık doğru şekilde engellendiğini doğrulamak (dosyanın sonunda hazır sorgular var).

### Geri alma
Migration dosyasında AYRI bir rollback bloğu yok (011'deki gibi) — ama gövde tek bir `CREATE OR REPLACE FUNCTION` olduğu için rollback basit: yukarıdaki "Canlı tanımın tam metni" bloğunu (bu dokümanda veya `supabase_subscription_auth.sql:44-75`'te) tekrar çalıştırmak yeterli.

---

## Özet tablo

| | Kapsam | Bağımlı olduğu | Test durumu | Rollback |
|---|---|---|---|---|
| Migration 011 | trial_ends_at tek kaynak (2 fonksiyon) | — | Canlı orphan-guard sorgusu doğrulandı (0 sonuç) | Dosyada yok, eski gövdeyi yeniden çalıştır |
| Migration 012 | 7 RPC'ye firma-yetki + 3 RLS + 3 search_path | Bağımsız | Aynı desen başka RPC'lerde canlı kanıtlı, bu 7'sinde değil | Kısmi (politika SQL'i hazır, fonksiyon için orijinal dosyayı öner) |
| Migration 013 | check_subscription_active kolon düzeltmesi | Bağımsız (012 ile birlikte tam koruma) | Bulgu canlı RPC çağrısıyla doğrulandı, düzeltme değil | Orijinal gövdeyi yeniden çalıştır (kolay) |
