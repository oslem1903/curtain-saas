// ============================================================================
// Finans servis katmanı — ortak tipler (FAZ 1: yalnızca altyapı).
//
// Bu modül henüz hiçbir ekrana bağlı değildir. Gerçek insert/update mantığı
// içermez; sonraki fazda yazılacak servisler için ortak sözlük/sözleşmeyi
// tanımlar. Mevcut ekranlardaki (NewOrder/OrderDetail/Accounting/SupplierLedger/
// InstallerLedger) davranış BİREBİR korunur — bu dosya hiçbirini değiştirmez.
// ============================================================================

/** Kiracı (tenant) bağlamı — getEffectiveTenantContext() sonucundan türetilir. */
export type TenantContext = {
  companyId: string;
  readOnly?: boolean;
};

/** Uygulama genelinde tutar TL cinsinden number olarak tutulur (kuruş ayrımı yok). */
export type Money = number;

/**
 * Ödeme yöntemi. Mevcut ekranlarda serbest metin olarak saklandığından
 * (payment_method kolonu) kısıtlayıcı bir union yerine bilinen değerleri
 * belgeleyen, yine de serbest string'e izin veren bir tip kullanılır.
 */
export type PaymentMethod = "nakit" | "havale" | "kredi_karti" | "cek" | (string & {});

/** ISO 8601 tarih/saat string'i (transaction_date, payment_date vb. kolonlarla uyumlu). */
export type IsoDateTime = string;

/** YYYY-MM-DD tarih string'i (due_date, period_start/end gibi DATE kolonlarla uyumlu). */
export type IsoDate = string;
