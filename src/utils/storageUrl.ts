// ============================================================================
// Supabase Storage görsel adresleri — TEK çözümleyici.
//
// KÖK NEDEN (canlı üretim veritabanında 14.09.2026'da doğrulandı):
// measurement-photos / catalog-images / logos / visual-previews bucket'larının
// tamamı PUBLIC. Uygulamanın anon anahtarı (her kurulumun içinde gömülü, yani
// herkeste var) ile bu bucket'ların KLASÖR LİSTESİ çekilebiliyor; klasör adları
// firma UUID'si olduğundan bir firmanın tüm ölçü fotoğrafları keşfedilebiliyor
// ve dosyalar HİÇBİR anahtar olmadan indirilebiliyor
// (/storage/v1/object/public/... -> HTTP 200). Bu, firmalar arası veri sızıntısıdır.
//
// ÇÖZÜM İKİ PARÇALIDIR:
//   1) KOD (bu dosya): görseller artık kalıcı public URL ile DEĞİL, kısa ömürlü
//      imzalı (signed) URL ile gösterilir.
//   2) VERİTABANI: bucket'lar private yapılıp storage.objects üzerinde firma
//      bazlı RLS kurulmalıdır (bkz. supabase_storage_tenant_isolation.sql).
//      Bu dosya UYGULANMADI — canlı veritabanı değişikliği ayrı onay ister.
//
// GEÇİŞ GÜVENLİĞİ: İmzalı URL'ler public bucket'ta da çalışır. Bu yüzden kod
// tarafı TEK BAŞINA devreye alınabilir; davranış değişmez. Bucket private
// yapıldığı anda görseller kırılmadan çalışmaya devam eder.
//
// VERİ TAŞIMA GEREKMEZ: Veritabanında saklı değerler tam public URL biçiminde.
// Buradaki çözümleyici hem tam URL'i hem de düz nesne yolunu kabul eder.
// ============================================================================

import { supabase } from "../supabaseClient";
import { parseStorageRef as parseRef } from "./storagePath";

export { STORAGE_BUCKETS, parseStorageRef, isLocalPreviewSrc } from "./storagePath";
export type { StorageRef } from "./storagePath";

const SIGN_TTL_SECONDS = 60 * 60; // 1 saat
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // bitimine 5 dk kala yenile

type CacheEntry = { url: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

/**
 * Görsel için gösterilebilir bir adres döner.
 *
 * - Storage nesnesi ise: kısa ömürlü imzalı URL (önbellekli).
 * - Storage nesnesi değilse (data:, blob:, dış adres): değeri olduğu gibi döner.
 * - İmzalama herhangi bir sebeple başarısız olursa: ORİJİNAL değeri döner.
 *   Böylece bu değişiklik tek başına devreye alındığında hiçbir görsel kırılmaz.
 */
export async function resolveStorageSrc(value: string | null | undefined, defaultBucket?: string): Promise<string> {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const ref = parseRef(raw, defaultBucket);
  if (!ref) return raw;

  const key = `${ref.bucket}/${ref.path}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt - REFRESH_MARGIN_MS > now) return hit.url;

  const pending = inflight.get(key);
  if (pending) return await pending;

  const task = (async () => {
    try {
      const { data, error } = await supabase.storage.from(ref.bucket).createSignedUrl(ref.path, SIGN_TTL_SECONDS);
      if (error || !data?.signedUrl) return raw;
      cache.set(key, { url: data.signedUrl, expiresAt: now + SIGN_TTL_SECONDS * 1000 });
      return data.signedUrl;
    } catch {
      return raw;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return await task;
}

/** Birden çok görseli aynı anda çözer (galeri/liste için). */
export async function resolveStorageSrcList(values: Array<string | null | undefined>, defaultBucket?: string): Promise<string[]> {
  return await Promise.all(values.map((v) => resolveStorageSrc(v, defaultBucket)));
}

/** Oturum değiştiğinde (çıkış/farklı firma) imzalı adres önbelleğini boşaltır. */
export function clearStorageUrlCache() {
  cache.clear();
  inflight.clear();
}
