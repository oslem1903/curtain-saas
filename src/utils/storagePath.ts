// ============================================================================
// Storage nesne yolu çözümleme — SAF fonksiyonlar (Supabase istemcisine bağımlı
// DEĞİL). Böylece node/tsx altında doğrudan test edilebilir
// (bkz. scripts/check-calculations.ts).
//
// Kullanım yeri: utils/storageUrl.ts (imzalı adres üretimi).
// ============================================================================

/**
 * Projedeki TÜM Storage bucket'ları (canlı veritabanından doğrulandı, 14.09.2026).
 *
 * Son dördü kodda `storage.from(...)` ile geçmiyor:
 *   - support-attachments : SupportModal/SuperAdminSupport kullanıyor (zaten imzalı)
 *   - appointment-photos  : ESKİ bucket, kodda hiç geçmiyor
 *   - catalog-pdfs        : ESKİ bucket, kodda hiç geçmiyor
 * Eski kayıtların veritabanındaki public URL'leri bu bucket'lara işaret ediyor
 * olabilir; listede olmaları o adreslerin de imzalanmasını sağlar. Bucket private
 * yapıldığında kırılmamaları için gereklidir.
 */
export const STORAGE_BUCKETS = [
  "measurement-photos",
  "catalog-images",
  "logos",
  "visual-previews",
  "support-attachments",
  "appointment-photos",
  "catalog-pdfs",
] as const;

const BUCKET_SET = new Set<string>(STORAGE_BUCKETS);

// .../storage/v1/object/public/<bucket>/<path>
// .../storage/v1/object/sign/<bucket>/<path>?token=...
// .../storage/v1/object/<bucket>/<path>
const STORAGE_URL_RE = /\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/?#]+)\/(.+?)(?:\?|#|$)/;

export type StorageRef = { bucket: string; path: string };

/** İmzalama gerektirmeyen yerel önizleme adresi mi? */
export function isLocalPreviewSrc(value: string | null | undefined): boolean {
  const raw = String(value ?? "");
  return raw.startsWith("data:") || raw.startsWith("blob:");
}

/**
 * Saklanan değerden (tam public/sign URL ya da düz "<bucket>/<path>" / "<path>")
 * bucket + nesne yolunu çıkarır. Bizim bucket'larımızdan biri değilse null döner
 * — bu durumda çağıran taraf değeri olduğu gibi kullanır.
 */
export function parseStorageRef(value: string | null | undefined, defaultBucket?: string): StorageRef | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (isLocalPreviewSrc(raw)) return null;

  if (/^https?:\/\//i.test(raw)) {
    const match = STORAGE_URL_RE.exec(raw);
    if (!match) return null;
    const [, bucket, path] = match;
    if (!BUCKET_SET.has(bucket)) return null;
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      /* zaten çözülmüş */
    }
    return { bucket, path: decoded };
  }

  // Düz yol: "measurement-photos/firma/dosya.png" ya da "firma/dosya.png"
  const clean = raw.replace(/^\/+/, "");
  const firstSegment = clean.split("/")[0];
  if (BUCKET_SET.has(firstSegment)) {
    return { bucket: firstSegment, path: clean.slice(firstSegment.length + 1) };
  }
  if (defaultBucket && BUCKET_SET.has(defaultBucket) && clean.includes("/")) {
    return { bucket: defaultBucket, path: clean };
  }
  return null;
}
