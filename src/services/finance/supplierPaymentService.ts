// ============================================================================
// SupplierPaymentService — tedarikçi ödemesi için tek giriş noktası.
// (FAZ 1: yalnızca iskelet — DB mantığı YOK, hiçbir ekrana bağlı DEĞİL.)
//
// Hedef davranış: SupplierDetail.tsx, SupplierLedger.tsx (Hızlı Ödeme) ve
// Accounting.tsx::saveSupplierPayment — üçü de İLERİDE bu servisi çağıracak.
// Bu fazda yalnızca tip/arayüz/iskelet vardır; gerçek insert/update FAZ 2'de
// eklenir. NOT: src/utils/supplierCari.ts (borç oluşturma) BU FAZDA
// DEĞİŞTİRİLMEDİ — o modül kendi başına çalışmaya devam ediyor.
// ============================================================================
import type { FinanceServiceDeps } from "./deps";
import type { FinanceResult } from "./results";
import { notImplementedError } from "./errors";
import type { IsoDate, Money, PaymentMethod, TenantContext } from "./types";

export type RecordSupplierPaymentParams = TenantContext & {
  supplierId: string;
  amount: Money;
  method: PaymentMethod;
  date?: IsoDate;
  note?: string;
  /** Ödeme belirli bir siparişe bağlıysa (opsiyonel bağlam bilgisi). */
  orderId?: string | null;
  /**
   * Çağıran taraf (UI) tarafından üretilen tekil anahtar (örn. UUID) —
   * çift tıklama / ağ retry senaryosunda aynı ödemenin iki kez
   * kaydedilmesini engellemek için FAZ 2 implementasyonu bunu kullanır.
   * Verilmezse dedupe uygulanmaz (mevcut/eski davranışla aynı).
   */
  idempotencyKey?: string;
};

export type SupplierPaymentRecord = {
  transactionId: string;
  expenseId: string | null;
  supplierId: string;
  amount: Money;
  newBalance: Money;
};

export type CancelSupplierPaymentParams = TenantContext & {
  transactionId: string;
};

export interface SupplierPaymentService {
  recordPayment(params: RecordSupplierPaymentParams): Promise<FinanceResult<SupplierPaymentRecord>>;
  cancelPayment(params: CancelSupplierPaymentParams): Promise<FinanceResult<void>>;
}

/** FAZ 1 stub — gerçek implementasyon FAZ 2'de eklenecek. */
export function createSupplierPaymentService(deps: FinanceServiceDeps): SupplierPaymentService {
  void deps;
  return {
    async recordPayment(params) {
      void params;
      return { status: "error", error: notImplementedError("SupplierPaymentService.recordPayment") };
    },
    async cancelPayment(params) {
      void params;
      return { status: "error", error: notImplementedError("SupplierPaymentService.cancelPayment") };
    },
  };
}
