import { supabase } from "../supabaseClient";

// ---------------------------------------------------------------------------
// Telefon normalizasyon kuralları (DB fonksiyonu public.normalize_phone ile eşleşmeli)
//
// Kural sırası:
//   "905321234567" (12 hane, 90 ile başlıyor) → aynen döndür
//   "05321234567"  (11 hane, 0 ile başlıyor)  → "9" + "05321234567" = "905321234567"
//   "5321234567"   (10 hane)                  → "90" + "5321234567"  = "905321234567"
//   Diğer  → sadece rakamları döndür (DB constraint tetikler, kullanıcıya mesaj gider)
//   Boş/null → null
// ---------------------------------------------------------------------------

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("90") && digits.length === 12) return digits;
  if (digits.startsWith("0")  && digits.length === 11) return "9" + digits;
  if (digits.length === 10)                            return "90" + digits;

  return digits; // tanımlanamayan format
}

// ---------------------------------------------------------------------------
// Duplicate telefon kontrolü
//
// normalized_phone computed kolonu mevcutsa tek indeksli sorgu kullanır.
// Kolon yoksa (migration henüz uygulanmadıysa) fallback: tüm müşterileri çek.
//
// existingCustomerId verilirse o müşteri hariç tutulur (güncelleme senaryosu).
// ---------------------------------------------------------------------------

export async function findDuplicatePhone(params: {
  companyId: string;
  phone: string | null | undefined;
  existingCustomerId?: string;
}): Promise<{ id: string; name: string | null } | null> {
  const normalized = normalizePhone(params.phone);
  if (!normalized) return null;

  // Önce normalized_phone kolonunu dene (migration uygulanmışsa hızlı yol)
  const fastQuery = supabase
    .from("customers")
    .select("id,name")
    .eq("company_id", params.companyId)
    .eq("normalized_phone", normalized)
    .limit(2);

  if (params.existingCustomerId) {
    fastQuery.neq("id", params.existingCustomerId);
  }

  const { data: fastData, error: fastError } = await fastQuery;

  // Eğer kolon yoksa (42703 = undefined_column) fallback kullan
  if (fastError) {
    if (/42703|normalized_phone|column.*does not exist/i.test(String(fastError.message))) {
      return findDuplicatePhoneFallback(params, normalized);
    }
    // Başka bir DB hatası — kontrol edemiyoruz, null döndür (DB constraint yakalar)
    console.warn("findDuplicatePhone hata:", fastError.message);
    return null;
  }

  if (!fastData || fastData.length === 0) return null;
  const hit = fastData[0] as { id: string; name: string | null };
  return { id: hit.id, name: hit.name };
}

// Migration uygulanmamışsa tüm müşteriyi çekip bellekte filtrele (eski davranış)
async function findDuplicatePhoneFallback(
  params: { companyId: string; existingCustomerId?: string },
  normalized: string,
): Promise<{ id: string; name: string | null } | null> {
  const { data, error } = await supabase
    .from("customers")
    .select("id,name,phone")
    .eq("company_id", params.companyId)
    .limit(2000); // fallback — migration sonrası bu yol kullanılmaz

  if (error || !data) return null;

  const match = (data as Array<{ id: string; name: string | null; phone: string | null }>).find((c) => {
    if (params.existingCustomerId && c.id === params.existingCustomerId) return false;
    return normalizePhone(c.phone) === normalized;
  });

  return match ? { id: match.id, name: match.name } : null;
}

// ---------------------------------------------------------------------------
// Kullanıcıya gösterilecek hata mesajları
// ---------------------------------------------------------------------------

/** Duplicate telefon için Türkçe hata mesajı */
export function duplicatePhoneMessage(
  existingName: string | null | undefined,
  phone: string | null | undefined,
): string {
  const nameStr = existingName ? `"${existingName}"` : "başka bir müşteri";
  const phoneStr = phone ? ` (${phone.trim()})` : "";
  return (
    `Bu telefon numarası${phoneStr} zaten ${nameStr} adıyla kayıtlı.` +
    " Lütfen mevcut müşteriyi seçin veya farklı bir numara girin."
  );
}

/** DB constraint hatasının kullanıcı dostu mesaja dönüştürülmesi */
export function phoneConstraintMessage(rawError: string, phone?: string | null): string {
  if (/unique|duplicate|customers_company_phone/i.test(rawError)) {
    const phoneStr = phone ? ` (${String(phone).trim()})` : "";
    return (
      `Bu telefon numarası${phoneStr} zaten başka bir müşteriye kayıtlı.` +
      " Lütfen mevcut müşteriyi seçin veya farklı bir numara girin."
    );
  }
  return rawError;
}

/** Telefonu görüntülenebilir formata çevirir: "905321234567" → "0532 123 45 67" */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return "";
  const norm = normalizePhone(raw);
  if (!norm) return raw;

  const local = norm.startsWith("90") ? norm.slice(2) : norm;
  if (local.length === 10) {
    return `0${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6, 8)} ${local.slice(8)}`;
  }
  return raw;
}
