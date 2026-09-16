// ============================================================================
// SecureLink — Storage'daki bir dosyaya giden <a> bağlantısını kısa ömürlü
// imzalı adrese çeviren bileşen (bkz. utils/storageUrl.ts).
//
// Fotoğrafı büyütmek için kullanılan "yeni sekmede aç" bağlantıları da kalıcı
// public URL taşıyordu; imzalanmazsa bucket private yapıldığında kırılırdı.
// ============================================================================

import { useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from "react";
import { resolveStorageSrc } from "../utils/storageUrl";

type SecureLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href?: string | null;
  bucket?: string;
  children?: ReactNode;
};

function immediateHref(value: string): string {
  if (!value) return "";
  return value.startsWith("data:") || value.startsWith("blob:") ? value : "";
}

export default function SecureLink({ href, bucket, children, onClick, ...anchorProps }: SecureLinkProps) {
  const value = href ?? "";
  const immediate = immediateHref(value);
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

  return (
    <a
      {...anchorProps}
      href={resolved || undefined}
      aria-disabled={resolved ? undefined : true}
      onClick={(event) => {
        // Adres henüz hazır değilse boş sekme açılmasın.
        if (!resolved) event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}
