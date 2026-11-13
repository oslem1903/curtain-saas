// Parçalı En: bir duvarın enini bölümlere (en çok 5) ayırıp kaydetme.
// Veri appointments.note içinde tek satırlık [Parcalar: {...}] işaretiyle taşınır
// (Photos işaretiyle aynı yöntem) — şema değişikliği ve migration gerektirmez; eski
// kayıtlarda işaret yoktur ve tek en × boy akışı aynen çalışır.

export const MAX_WIDTH_SEGMENTS = 5;

export type WidthSegment = { id: string; name: string; cm: number };
export type SegmentedWidth = {
  segments: WidthSegment[];
  /** Ürünün kapladığı parçaların id'leri (boşsa tüm parçalar = toplam en). */
  selectedIds: string[];
};

const MARKER_RE = /\n?\[Parcalar:\s*(\{.*\})\]/;

export function isValidCm(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export function totalWidth(segments: Array<{ cm: number }>): number {
  return Math.round(segments.reduce((s, x) => s + (Number(x.cm) || 0), 0) * 100) / 100;
}

/** Ürünün kapladığı en: seçili parçaların toplamı; seçim yoksa toplam en. */
export function coveredWidth(sw: SegmentedWidth): number {
  const picked = sw.selectedIds.length
    ? sw.segments.filter((s) => sw.selectedIds.includes(s.id))
    : sw.segments;
  return totalWidth(picked);
}

/** Hata mesajı döner (kaydedilmemeli) veya null. */
export function validateSegments(sw: SegmentedWidth): string | null {
  if (sw.segments.length === 0) return "En az 1 parça girin.";
  if (sw.segments.length > MAX_WIDTH_SEGMENTS) return `En fazla ${MAX_WIDTH_SEGMENTS} parça eklenebilir.`;
  for (const [i, s] of sw.segments.entries()) {
    if (!isValidCm(s.cm)) return `${i + 1}. parçanın eni 0'dan büyük geçerli bir sayı olmalı.`;
  }
  const ids = new Set(sw.segments.map((s) => s.id));
  if (sw.selectedIds.some((id) => !ids.has(id))) return "Seçili parça bulunamadı.";
  if (!isValidCm(coveredWidth(sw))) return "Ürün eni 0'dan büyük olmalı.";
  return null;
}

/** Tek satır işaret metni (note'a eklenir). Geçersizse boş string. */
export function serializeSegments(sw: SegmentedWidth | null | undefined): string {
  if (!sw || validateSegments(sw)) return "";
  const parts = sw.segments.map((s) => ({ n: s.name.trim(), c: s.cm }));
  const sel = sw.selectedIds.length
    ? sw.segments.map((s, i) => (sw.selectedIds.includes(s.id) ? i : -1)).filter((i) => i >= 0)
    : [];
  return `[Parcalar: ${JSON.stringify({ v: 1, p: parts, s: sel })}]`;
}

/** note içinden okur; işaret yoksa/bozuksa null (eski kayıt). */
export function parseSegments(note: string | null | undefined): SegmentedWidth | null {
  const m = String(note ?? "").match(MARKER_RE);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1]);
    if (!raw || !Array.isArray(raw.p) || raw.p.length === 0 || raw.p.length > MAX_WIDTH_SEGMENTS) return null;
    const segments: WidthSegment[] = [];
    for (const [i, p] of raw.p.entries()) {
      const cm = Number(p?.c);
      if (!isValidCm(cm)) return null;
      segments.push({ id: `seg-${i}`, name: typeof p?.n === "string" ? p.n : "", cm });
    }
    const selectedIds = (Array.isArray(raw.s) ? raw.s : [])
      .filter((i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < segments.length)
      .map((i: number) => segments[i].id);
    return { segments, selectedIds };
  } catch {
    return null;
  }
}

/** note'tan işareti çıkarır (iç notta/siparişte görünmesin). */
export function stripSegmentsMarker(note: string | null | undefined): string {
  return String(note ?? "").replace(MARKER_RE, "").trim();
}

export function describeSegments(sw: SegmentedWidth): string {
  return sw.segments.map((s, i) => `${s.name.trim() || `Parça ${i + 1}`} ${s.cm} cm`).join(" + ");
}
