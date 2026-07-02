// ============================================================================
// SAHA BİLGİLERİ (Field Info) — PerdePRO profesyonel saha kayıt veri modeli
// ----------------------------------------------------------------------------
// Tek bir JSON yapısı; ölçü (appointments.field_info) ve sipariş kalemi
// (order_items.product_options.field_info) içinde taşınır. Geriye dönük uyumlu:
// eski kayıtlarda alan yoksa boş kabul edilir; eski tekil swatch_photo_url /
// color_name değerleri tolerant şekilde okunur.
// Tüm dosyalar mevcut PUBLIC 'measurement-photos' bucket'ında saklanır.
// ============================================================================
import { supabase } from "../supabaseClient";

export type FieldInfo = {
  swatch_code: string;            // 1. Kartela / Renk kodu (ZB-214, Bambu 301...)
  swatch_photo_url: string | null;// 2. Kartela fotoğrafı (gerekirse işaretlenmiş)
  room_photos: string[];          // 3. Mekan fotoğrafları (çoklu, sıralı)
  voice_note_url: string | null;  // 4. Sesli not
  install_note: string;           // 5. Montaj notu (çok satırlı)
};

const BUCKET = "measurement-photos";

export function emptyFieldInfo(): FieldInfo {
  return { swatch_code: "", swatch_photo_url: null, room_photos: [], voice_note_url: null, install_note: "" };
}

/**
 * Herhangi bir kaynaktan (appointments.field_info, order_items.product_options,
 * ya da doğrudan field_info objesi) tolerant FieldInfo üretir. Geriye dönük uyumlu.
 */
export function parseFieldInfo(source: any): FieldInfo {
  const out = emptyFieldInfo();
  if (!source || typeof source !== "object") return out;
  const fi = (source.field_info && typeof source.field_info === "object") ? source.field_info : source;

  if (typeof fi.swatch_code === "string" && fi.swatch_code) out.swatch_code = fi.swatch_code;
  else if (typeof source.color_name === "string" && source.color_name) out.swatch_code = source.color_name; // eski kayıt

  out.swatch_photo_url = (typeof fi.swatch_photo_url === "string" ? fi.swatch_photo_url : null)
    ?? (typeof source.swatch_photo_url === "string" ? source.swatch_photo_url : null);

  if (Array.isArray(fi.room_photos)) out.room_photos = fi.room_photos.filter((u: any): u is string => typeof u === "string" && !!u);

  out.voice_note_url = typeof fi.voice_note_url === "string" ? fi.voice_note_url : null;
  out.install_note = typeof fi.install_note === "string" ? fi.install_note : "";
  return out;
}

/** En az bir saha bilgisi dolu mu? (boş kartları gizlemek için) */
export function hasFieldInfo(fi: FieldInfo | null | undefined): boolean {
  if (!fi) return false;
  return Boolean(
    (fi.swatch_code && fi.swatch_code.trim()) ||
    fi.swatch_photo_url ||
    (fi.room_photos && fi.room_photos.length > 0) ||
    fi.voice_note_url ||
    (fi.install_note && fi.install_note.trim()),
  );
}

/** order_items.product_options için: mevcut alanları koruyup field_info ekler. */
export function mergeFieldInfoIntoProductOptions(existing: any, fi: FieldInfo): Record<string, any> {
  const base = (existing && typeof existing === "object") ? { ...existing } : {};
  return {
    ...base,
    // Geriye dönük okuyucular için tekil alanları da güncel tut
    color_name: fi.swatch_code || base.color_name || "",
    swatch_photo_url: fi.swatch_photo_url ?? null,
    field_info: fi,
  };
}

/** Bir Blob'u measurement-photos bucket'ına yükler ve public URL döner (hata → null). */
export async function uploadFieldFile(companyId: string, file: Blob, prefix: string, ext: string): Promise<string | null> {
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${companyId}/${prefix}-${Date.now()}-${rand}.${ext}`;
  const contentType = (file as any).type || undefined;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType });
  if (error) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** dataURL → Blob (annotation/önizleme çıktısı yüklemek için). */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}
