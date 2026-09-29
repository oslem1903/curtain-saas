/**
 * Hata nesnesinden kullanıcıya gösterilecek metni çıkarır.
 * supabase-js PostgrestError bir `Error` örneği DEĞİLDİR (düz nesne); bu yüzden
 * `err instanceof Error` kontrolü gerçek mesajı yutup genel yedek metne düşüyordu.
 * Hiçbir zaman "undefined"/"null"/boş metin döndürmez.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; error_description?: unknown; details?: unknown };
    for (const v of [o.message, o.error_description, o.details]) {
      if (typeof v === "string" && v.trim() && v.trim() !== "undefined" && v.trim() !== "null") return v.trim();
    }
  }
  return fallback;
}
