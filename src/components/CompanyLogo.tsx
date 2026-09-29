// ============================================================================
// CompanyLogo — şirket logosu için TEK ortak gösterim bileşeni.
//
// Sol menü, üst başlık, Ayarlar önizlemesi gibi her yerde aynı mantık
// kullanılsın diye: logo varsa göster, yoksa (veya yüklenemezse) şirket
// adının ilk harfini gösteren varsayılan rozete düş.
// ============================================================================

import SecureImage from "./SecureImage";

type CompanyLogoProps = {
  logoUrl: string | null | undefined;
  companyName: string;
  /** Tailwind boyut sınıfları, örn. "w-8 h-8" */
  sizeClassName?: string;
  className?: string;
};

export default function CompanyLogo({
  logoUrl,
  companyName,
  sizeClassName = "w-8 h-8",
  className = "",
}: CompanyLogoProps) {
  const initial = (companyName || "?").trim().charAt(0).toUpperCase() || "?";

  if (!logoUrl) {
    return (
      <div
        className={`${sizeClassName} rounded-lg bg-primary-600 text-white flex items-center justify-center font-bold shrink-0 ${className}`}
      >
        {initial}
      </div>
    );
  }

  return (
    <SecureImage
      src={logoUrl}
      alt={companyName}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
      className={`${sizeClassName} rounded-lg object-contain bg-white shrink-0 shadow-sm ${className}`}
    />
  );
}
