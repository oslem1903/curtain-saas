// ============================================================================
// Tarih yardımcıları — YEREL saat dilimi (Europe/Istanbul) esaslı.
//
// KRİTİK: `new Date().toISOString().slice(0, 10)` UTC tarihi döndürür.
// Türkiye UTC+3 olduğu için gece 00:00–03:00 arasında BİR ÖNCEKİ günü verir.
// Bu; vade/gecikme hesaplarını, "bugün" kovasını ve "bugün + N gün" vade
// hesaplarını yanlış yapar. Tüm tarih işlemleri bu modülden geçmelidir.
// ============================================================================

/** Date -> "YYYY-MM-DD" (yerel saat dilimi). */
export function toLocalDateISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Bugünün tarihi "YYYY-MM-DD" (yerel). */
export function todayLocalISO(): string {
  return toLocalDateISO(new Date());
}

/** Bugünden N gün sonrası "YYYY-MM-DD" (yerel). Negatif değer geçmişi verir. */
export function addDaysLocalISO(days: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + days);
  return toLocalDateISO(d);
}

/**
 * "YYYY-MM-DD" ya da ISO timestamp'i YEREL gün başlangıcına (00:00) çevirir.
 * Saf tarih ("2026-09-13") `new Date()` ile UTC kabul edilir; bu fonksiyon
 * yerel gün olarak yorumlar. Geçersizse null.
 */
export function parseLocalDateOnly(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const trimmed = String(value).trim();
  if (!trimmed) return null;

  // Saf tarih ("2026-09-13") → o gün, yerel. new Date() bunu UTC sanardı.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }

  // Zaman damgası → yerel takvim günü.
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  const loose = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (loose) return new Date(Number(loose[1]), Number(loose[2]) - 1, Number(loose[3]));
  return null;
}

/**
 * DB'den gelen tarih/zaman damgasını `<input type="date">` değerine çevirir.
 * Boş/geçersiz girdide boş string döner (input'u kırmaz).
 */
export function toDateInputValue(value: string | number | Date | null | undefined): string {
  const d = parseLocalDateOnly(value);
  return d ? toLocalDateISO(d) : "";
}

/** İki "YYYY-MM-DD" arasındaki tam gün farkı (to - from). DST'den etkilenmez. */
export function diffDaysLocal(fromStr: string, toStr: string): number {
  const from = parseLocalDateOnly(fromStr);
  const to = parseLocalDateOnly(toStr);
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
