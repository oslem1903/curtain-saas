// ============================================================================
// Ödeme yöntemi — TEK doğruluk kaynağı (kanonik değerler + Türkçe etiketler).
//
// Kök neden: ekranlar farklı değer kümeleri yazıyordu —
//   Accounting / Collections / InstallerLedger : nakit, eft, havale, kredi_karti, cek
//   Suppliers (tedarikçi ödemesi)              : cash, bank_transfer, check, credit_card  ← İngilizce
// Bu yüzden kullanıcı bazı ekranlarda ham "cash" / "bank_transfer" görüyordu.
//
// Karar:
//   1) Yeni kayıtlar HER YERDE kanonik Türkçe değerlerle yazılır
//      (PAYMENT_METHOD_OPTIONS).
//   2) Ekrana/rapora basılan her payment_method `paymentLabel()` üzerinden
//      geçirilir; eski İngilizce değerler de burada Türkçeye çevrilir, böylece
//      geçmiş kayıtlar veri taşıma (migration) yapılmadan da doğru görünür.
// ============================================================================

/** Kanonik değerler — yeni kayıtlarda YALNIZCA bunlar yazılır. */
export const PAYMENT_METHOD_OPTIONS = [
  { value: "nakit", label: "Nakit" },
  { value: "havale", label: "Havale" },
  { value: "eft", label: "EFT" },
  { value: "kredi_karti", label: "Kredi Kartı" },
  { value: "banka_karti", label: "Banka Kartı" },
  { value: "cek", label: "Çek" },
  { value: "senet", label: "Senet" },
  { value: "diger", label: "Diğer" },
] as const;

export type PaymentMethodValue = (typeof PAYMENT_METHOD_OPTIONS)[number]["value"];

/** Kanonik değerler + eski/İngilizce eşanlamlıları. */
const LABELS: Record<string, string> = {
  // kanonik
  nakit: "Nakit",
  havale: "Havale",
  eft: "EFT",
  kredi_karti: "Kredi Kartı",
  banka_karti: "Banka Kartı",
  cek: "Çek",
  senet: "Senet",
  diger: "Diğer",
  // eski İngilizce değerler (Suppliers ekranı ve e-posta şablonları)
  cash: "Nakit",
  bank: "Banka",
  banka: "Banka",
  transfer: "Havale",
  bank_transfer: "Havale",
  wire: "Havale",
  card: "Kart",
  kart: "Kart",
  credit_card: "Kredi Kartı",
  creditcard: "Kredi Kartı",
  debit_card: "Banka Kartı",
  check: "Çek",
  cheque: "Çek",
  other: "Diğer",
  // serbest metin girilmiş eski kayıtlar
  "kredi kartı": "Kredi Kartı",
  "banka kartı": "Banka Kartı",
};

/**
 * Ham payment_method değerini Türkçe etikete çevirir.
 * Tanınmayan değerler (kullanıcının serbest yazdığı metinler) olduğu gibi döner.
 */
export function paymentLabel(method: string | null | undefined): string {
  const raw = String(method ?? "").trim();
  if (!raw) return "";
  return LABELS[raw.toLowerCase()] ?? raw;
}

/** Tablo/liste hücreleri için: boş değerde "—" gösterir. */
export function paymentLabelOrDash(method: string | null | undefined): string {
  return paymentLabel(method) || "—";
}

// Otomatik üretilmiş açıklamalarda geçen yöntem adı ("cash ile ödeme") çevrilir;
// kullanıcının kendi yazdığı notlara dokunulmaz.
const GENERATED_DESCRIPTION = new RegExp(
  `^(${Object.keys(LABELS).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}) ile ödeme$`,
  "i",
);

export function paymentDescription(description: string | null | undefined): string {
  const text = description || "";
  const match = GENERATED_DESCRIPTION.exec(text.trim());
  return match ? `${paymentLabel(match[1])} ile ödeme` : text;
}
