# Migration 029 — analiz, karar ve çalıştırma planı (2026-10-13)

**Durum: üretime HİÇBİR 029 parçası uygulanmadı.** Bu oturumda PerdePRO projesine yönetim erişimi (SQL Editor)
yoktu; canlı karşılaştırma ve uygulama adımları erişim gelince aşağıdaki sırayla yapılacak.

## 1. Karar: 029 olduğu gibi değil, 029a (iki RPC)

`supabase_migration_029_subscription_access_lockdown.sql` başlığı kendisi "**UYGULAMAYIN (2026-10-11 kararı)**"
der. Dosya şunları yapar:

| 029'un yaptığı | Sorun |
|---|---|
| 45 tabloya `RESTRICTIVE ... FOR ALL` politika (USING + WITH CHECK) | **SELECT dahil**: süre bitince firma kendi verisini göremez/dışa aktaramaz. Güncel ürün kararı: süre bitince görüntüleme ve dışa aktarma AÇIK, yazma kapalı. |
| 45 tabloda `FORCE ROW LEVEL SECURITY` | Tablo sahibi/SECURITY DEFINER fonksiyonlar da RLS'e tabi olur; `auth.uid()` boş çalışan işler (cron, webhook, bakım) etkilenebilir. Geri alması riskli. |
| `is_company_writable`, `check_subscription_active`, `register_device_and_touch_login`, `company_subscription_allows_write` yeniden yazılır | Davranışı değişen 4 mevcut fonksiyon (aşağıda karşılaştırma). |
| `company_subscription_access_allowed/snapshot` RPC'leri | **Frontend'in (1.0.14) çağırdığı tek şey bunlar.** |

Frontend yalnızca `company_subscription_access_allowed` ve `company_subscription_access_snapshot` RPC'lerini çağırır
(`src/context/AuthContext.tsx:362`, `src/layouts/Layout.tsx:384,388`); yoksa `isTrialExpired()` yedeğine düşer.
Sunucu tarafı **yazma** koruması üretimde zaten `024/025`'teki `BEFORE INSERT/UPDATE/DELETE` tetikleyicileriyle
(`enforce_company_subscription_write`) vardır.

**Bu yüzden hazırlanan:** `supabase_migration_029a_subscription_rpcs_only.sql` — yalnızca iki RPC. `access_allowed`
029'dan **birebir** (md5 `92770fff…`); `snapshot` iki güvenlik düzeltmesiyle türetildi (md5 `49c628f6…`, bkz. §8).
Mevcut hiçbir nesneyi değiştirmez. **Ürün kararı (kesin): tam 029 uygulanmaz.** Geri alma:
`supabase_migration_029a_rollback.sql` (iki `DROP FUNCTION`). Tam 029'un kapsamı (SELECT kilidi, FORCE RLS) ayrıca
tasarlanıp test edilmeden uygulanmamalıdır.

## 2. Üretimde eksiklik — kanıt

QA hesabıyla çağrı: `company_subscription_access_allowed` / `company_subscription_access_snapshot` → **HTTP 404
(PGRST202)**. Yayındaki web paketi (sha `5ee5425`, 2026-10-04) bu RPC'leri çağırmıyor (pakette referans yok); yalnızca
1.0.14 çağırıyor ve yedeğe düşüyor. Yani eksiklik bugün kullanıcıya yansımıyor, 1.0.14 yayınlanmadan kapatılmalı.

## 3. Fonksiyon gövdesi karşılaştırması (repo sürümleri)

`node scripts/function-body-hashes.mjs --show is_company_writable check_subscription_active` ile üretilir.
Canlıdaki md5 için `supabase_migration_029_live_diff_readonly.sql` çalıştırılıp eşleştirilir (**canlı md5 henüz alınamadı**).

| Fonksiyon | Sürüm | Davranış |
|---|---|---|
| `is_company_writable` | 011 (`e79a5d83…`) | admin/owner üye + firma aktif/read_only değil + (pilot **süresiz** ∨ active ∨ lifetime ∨ trial süresi geçerli) |
| | 022 (`0b5b0e7b…`) | + `active` için `license_expires_at` kontrolü |
| | 026 (`82951037…`) | + `pilot_until` (pilot süresi) |
| | 029 (`53883f03…`) | üyelik `is_active` + `company_subscription_allows_write()`'e devreder; `read_only`/süre kararı artık orada |
| `check_subscription_active` | 013 (`9f3b8d7d…`) | `plan_status`/`is_pilot`/`trial_ends_at`, NULL = kapalı (fail-closed) |
| | 026 (`ed827621…`) | + `pilot_until` |
| | 029 (`12287a6b…`) | tamamen `company_subscription_access_allowed()`'e devreder (süper admin/üyelik dahil) |

Önceki canlı gözlemim (2026-10-12): `check_subscription_active` `plan_status/is_pilot/pilot_until/trial_ends_at`
okuyor, `search_path` sabit → **026 ailesiyle uyumlu** (013'ün üstünde). `is_company_writable` canlıda `is_super_admin()`
+ admin/owner üyelik + `companies` koşulu gövdesine sahip → 011/022/026 ailesi. Hangisi olduğu md5 ile netleşecek.

**029'un tam uygulanmasının etkisi (karar gerekçesi):** `check_subscription_active` artık çağıranın o firmaya
*aktif üye* olmasını (veya süper admin olmasını) şart koşar; oturumsuz çağrılarda (`auth.uid()` boş: service_role,
cron, webhook) `false` döner — bu fonksiyonu kullanan finansal RPC'ler bu bağlamlarda reddeder.
`register_device_and_touch_login` süresi dolan firmada `'expired'` döner (cihaz kaydı yapmaz); pilot hesaplar
`pilot_until` NULL ise süresiz kalır. (`check_subscription_active` için 029 sürümü 013/026'dan farklı olarak
yalnızca `company_subscription_access_allowed()`'e devreder.)

## 4. Etki analizi (canlı sorguyla — bekliyor)

`supabase_migration_029_live_diff_readonly.sql` tek hücrede: ilgili fonksiyonların md5/secdef/config'i, yazma koruma
tetikleyicisinin bağlı olduğu tablolar, 029 politikası kurulu mu, 45 tabloluk ön kontrol (yok/RLS kapalı/FORCE zaten/
company_id tipi) ve **her firma için** `WOULD_ALLOW_029` (müşteri adları maskeli; yalnız "Apple Test"/"Test Company"
adı gösterilir). Beklenen: Apple Test (pilot, `trial_ends_at` 2026-10-31) → izinli.

## 5. Yedek ve geri dönüş

029a yalnızca **yeni** iki fonksiyon ekler; değiştirilen nesne yoktur, dolayısıyla veri yedeği gerekmez. Uygulamadan
önce kayıt altına alınacaklar: (1) `supabase_migration_029_live_diff_readonly.sql` çıktısı (md5 + firma durumu),
(2) `select pg_get_functiondef(oid) from pg_proc where proname in ('is_company_writable','check_subscription_active',
'register_device_and_touch_login','company_subscription_allows_write');` çıktısı (tam 029 düşünülürse). Geri alma:
`supabase_migration_029a_rollback.sql`.

## 6. Çalıştırma sırası (erişim gelince)

1. `supabase_migration_029_live_diff_readonly.sql` (salt-okunur) → bölüm 3-4'ü canlı değerlerle kapat.
2. `supabase_migration_029a_subscription_rpcs_only.sql` (tek transaction, preflight + postcheck).
3. `node scripts/verify-subscription-gate.mjs --user B --expect active` (RPC'ler + yazma).
4. QA firması B için `trial_ends_at` eski değeri kaydedilip **geçmişe** alınır (yalnız QA firması, UUID ile).
5. `node scripts/verify-subscription-gate.mjs --user B --expect expired` (access_allowed=false; doğrudan
   REST insert/update/delete engellenir; SELECT açık).
6. `trial_ends_at` **eski değerine** geri yazılır; `--cleanup` ile probe silinir.

## 7. Yayındaki uygulama adresi

| Adres | Durum |
|---|---|
| `https://oslem1903-curtain-saas.vercel.app` | **Çalışıyor**; paket PerdePRO Supabase'ine (`ffhmzlcsgsgjonqqhgqq`) bağlı; QA akışları geçti |
| `https://curtain-saas.vercel.app` | **Boş sayfa**: `Invalid supabaseUrl` — Vercel projesi `curtain-saas` Production'da `VITE_SUPABASE_*` ortam değişkenleri eksik |
| `https://app.perdepro.com` | **DNS yok** (NXDOMAIN); repoda tek belge referansı |
| `*-ilk16.vercel.app` | Vercel SSO korumalı (erişim yok) |

Kaynak: GitHub Deployments (`Production – oslem1903-curtain-saas`, `Production – curtain-saas`, son sha `5ee5425`).

## 8. İkinci tur (2026-10-13): RPC/istemci incelemesi, düzeltmeler, yayın sürüm farkı

**Erişim durumu:** Bu oturumda PerdePRO'ya yetkili Supabase oturumu YOKTU (Chrome OZI org'una düşüyor; "Lima" yok).
Hiçbir şey uygulanmadı/değiştirilmedi; canlı karşılaştırma ve test adımları bekliyor.

### 8.1 RPC gövdeleri ve yetkiler (statik inceleme)
| Konu | Bulgu | Durum |
|---|---|---|
| `access_allowed` yetkisi | `REVOKE ... FROM PUBLIC, anon; GRANT ... TO authenticated`; çağıran süper admin veya firmanın aktif üyesi değilse **false** (hata değil) → başka firmanın aboneliği hakkında bilgi vermez | Uygun |
| `snapshot` — NULL güvenliği | `is_super_admin()` profili olmayan kullanıcıda NULL döner; 029'daki `NOT is_super_admin() AND NOT EXISTS(...)` NULL olup `IF`'e girmezdi → **üyelik kontrolü atlanabilirdi** | `coalesce(...,false)` ile düzeltildi |
| `snapshot` — varlık sızıntısı | Önce "firma var mı" (NOT_FOUND), sonra üyelik (FORBIDDEN): üye olmayan, firma id'sinin varlığını ayırt edebilirdi | Üyelik ÖNCE; var/yok aynı hata (42501) |
| `false` sonucunun anlamı | Yalnızca "yazma kapalı". RPC hiçbir veri erişimini değiştirmez; SELECT politikalarına dokunmaz | Uygun |
| Sınır koşulu | `access_allowed` `> now()`, 024/026 `allows_write` `>= now()` — yalnızca tam-an eşitlikte fark (pratik etkisiz) | Belgelendi |

### 8.2 İstemci davranışı — ürün kararına AYKIRI bulgu ve düzeltme
`AuthContext`/`Layout`, `access_allowed=false` iken uygulamayı **kilitlemez**, yalnızca salt-okunur moda alır
(`setAppReadOnlyMode(true)`, durum `ready`; `lockReason` yalnızca bayrak). Ancak `supabaseClient.ts` `customFetch`
salt-okunur modda **tüm POST'ları** engelliyordu. PostgREST RPC'leri ve Storage imzalama/listeleme de POST olduğu için:

- `get_supplier_ledger` (Tedarikçi cari görüntüleme/PDF) ve `get_branch_stats` → süre bitince **bozulurdu**;
- `createSignedUrl` (`POST /storage/v1/object/sign/…`) → fotoğraflar süre bitince **görüntülenemezdi**
  (bucket'lar artık private; `SecureImage` imzasız adrese düşer).

**Düzeltme:** `src/utils/readOnlyGuard.ts` (`isReadOnlyBlocked`) — GET/HEAD asla engellenmez; okuma RPC'leri
(`get_supplier_ledger`, `get_branch_stats`) ve Storage `sign`/`list` izinli; INSERT/UPDATE/DELETE, yazan RPC'ler ve
Storage yükleme/silme engelli. 6 yeni birim testi (`npm run test:calc`, toplam 38) geçti; `tsc -b` ve eslint temiz.

### 8.3 Yazma koruması kapsamı (024/025)
Statik: 029'un 45 tablosunun **tamamı** 024 (37 tablo) + 025 (8 tablo) `BEFORE INSERT/UPDATE/DELETE` tetikleyicileriyle
kapsanıyor (`enforce_company_subscription_write`). Canlıda gerçekten kurulu olduğu ve **kapsam dışı `company_id`'li tablo**
olup olmadığı `supabase_migration_029_live_diff_readonly.sql`'in `WRITE_GUARD_TRIGGER` / `UNGUARDED_COMPANY_TABLE`
bölümleriyle doğrulanacak (**canlıda doğrulanmadı**).

**Olası açık (taslak, UYGULANMADI):** Storage yazma politikaları (`perdepro_objects_insert/update/delete`) abonelik
durumuna bakmıyor; tetikleyiciler yalnızca public tablolarda. `supabase_migration_029b_storage_write_guard.sql`
yalnızca bu üç politikaya `company_subscription_allows_write(...)` ekler (SELECT'e ve `support-attachments`'a — destek
sure bitince açık kalır — dokunmaz; FORCE RLS yok). Yalnızca doğrulama betiği süresi bitmiş QA firmasında yüklemenin
engellenmediğini **kanıtlarsa** uygulanır.

### 8.4 Yayındaki sürüm ve doğru Vercel projesi
| | Yayındaki (production) | Yerel |
|---|---|---|
| Commit | `5ee5425` (master, 2026-10-04) | `release/1.0.14-access-trial7`, 18 commit ileride |
| `package.json` sürümü | 1.0.12 (pakette `1.0.4.1` görünür: Vercel `VITE_APP_VERSION` eski değeri) | 1.0.14 |
| `src/` farkı | — | 18 dosya, +934/−79 |
| Abonelik RPC çağrısı | yok | var (029a eksikliğinde yedeğe düşer) |

Vercel (scope `ilk16`, iki proje aynı repoyu derliyor):
- `oslem1903-curtain-saas` → **çalışan**; `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_VERSION` (Secret, 51 gün önce) Production+Preview.
- `curtain-saas` → **boş sayfa**: `VITE_SUPABASE_URL` 2 gün önce eklendi (Config) ama son production derlemesi 10-04'te;
  değişken derlemeden sonra geldiği için pakette URL yok. **Yeniden dağıtım (Redeploy) gerekir**; yeni `vite.config.ts`
  korumasıyla (URL/anon eksikse derleme hata verir) tekrar bozulması engellenir.
- `app.perdepro.com` iki projeye de atanmamış (NXDOMAIN).
Bu üç madde (hangi proje canonical, domain atama, redeploy) **kalan yayın işidir**; bu oturumda değiştirilmedi.

