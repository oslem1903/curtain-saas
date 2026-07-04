// ============================================================================
// Finans servis katmanı — barrel export (FAZ 1: yalnızca altyapı).
//
// Bu katman henüz hiçbir ekrana bağlı değildir. Mevcut ekranlar (NewOrder,
// OrderDetail, Quotes, Accounting, SupplierDetail, SupplierLegder,
// InstallerLedger) hâlâ kendi eski insert/update mantığını kullanıyor.
// ============================================================================
export * from "./types";
export * from "./results";
export * from "./errors";
export * from "./deps";
export * from "./decisions";
export * from "./customerCollectionService";
export * from "./supplierPaymentService";
export * from "./installerPaymentService";
export * from "./financeService";
