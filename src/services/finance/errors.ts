// ============================================================================
// Finans servisleri için ortak hata modeli (FAZ 1: yalnızca altyapı).
//
// Supabase/Postgrest hataları, doğrulama hataları ve "henüz uygulanmadı"
// (FAZ 1 stub) durumları tek bir şekilde temsil edilir. Tüm finans servisleri
// (tahsilat/tedarikçi ödemesi/montajcı ödemesi) aynı hata sözleşmesini kullanır.
// ============================================================================

export type FinanceErrorCode =
  | "invalid_amount"
  | "invalid_reference"
  | "not_found"
  | "overpayment_blocked"
  | "unauthorized"
  | "db_error"
  | "not_implemented";

export class FinanceError extends Error {
  readonly code: FinanceErrorCode;

  constructor(code: FinanceErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "FinanceError";
    this.code = code;
  }
}

/** Bilinmeyen bir hatayı (örn. Supabase PostgrestError) FinanceError'a normalize eder. */
export function toFinanceError(e: unknown, fallbackCode: FinanceErrorCode = "db_error"): FinanceError {
  if (e instanceof FinanceError) return e;
  const message =
    typeof e === "object" && e !== null && "message" in e && typeof (e as { message: unknown }).message === "string"
      ? (e as { message: string }).message
      : "Beklenmeyen bir hata oluştu.";
  return new FinanceError(fallbackCode, message, e);
}

/**
 * FAZ 1: gerçek implementasyon henüz yazılmadı. Servisler bunu bilinçli
 * olarak döner ki yanlışlıkla bir ekrandan çağrılırsa sessizce no-op olmak
 * yerine açıkça hata versin.
 */
export function notImplementedError(serviceName: string): FinanceError {
  return new FinanceError(
    "not_implemented",
    `${serviceName} henüz uygulanmadı (FAZ 1 — yalnızca altyapı). Bu fonksiyon hiçbir ekrandan çağrılmamalı.`,
  );
}
