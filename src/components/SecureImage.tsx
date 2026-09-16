// ============================================================================
// SecureImage — Supabase Storage'daki görselleri kısa ömürlü imzalı adresle
// gösteren <img> yerine geçen bileşen.
//
// Neden: bucket'lar public olduğu için kalıcı public URL'ler herkes tarafından
// indirilebiliyordu (bkz. utils/storageUrl.ts başlığı). Bu bileşen, uygulamadaki
// tüm görsel gösterimlerini tek bir imzalama noktasından geçirir.
//
// Davranış: props'ları <img> ile birebir aynıdır; yalnızca `src` çözümlenir.
// Storage nesnesi olmayan değerler (data:, blob:, dış adres) olduğu gibi geçer.
// ============================================================================

import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { resolveStorageSrc } from "../utils/storageUrl";

type SecureImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "ref"> & {
  src?: string | null;
  /** Değer düz yol olarak saklanmışsa hangi bucket'a ait olduğunu belirtir. */
  bucket?: string;
};

/** Yüklenene kadar yerini koruyan saydam 1x1 görsel (kırık ikon görünmesin). */
const PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** İmzalama gerektirmeyen (yerel önizleme) değerler render sırasında belirlenir. */
function immediateSrc(value: string): string {
  if (!value) return "";
  return value.startsWith("data:") || value.startsWith("blob:") ? value : "";
}

export default function SecureImage({ src, bucket, ...imgProps }: SecureImageProps) {
  const value = src ?? "";
  const immediate = immediateSrc(value);
  // Çözülen adres hangi kaynağa aitse onunla birlikte tutulur; `src` değiştiğinde
  // eski görselin adresi bir an için yeni görselde kullanılmaz.
  const [signed, setSigned] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!value || immediate) return;
    let alive = true;
    void resolveStorageSrc(value, bucket).then((url) => {
      if (alive) setSigned({ key: value, url });
    });
    return () => {
      alive = false;
    };
  }, [value, bucket, immediate]);

  const resolved = immediate || (signed && signed.key === value ? signed.url : "");

  return <img {...imgProps} src={resolved || PLACEHOLDER} />;
}
