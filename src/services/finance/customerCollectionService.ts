// ============================================================================
// CustomerCollectionService — tahsilat için tek giriş noktası.
// (FAZ 1: yalnızca iskelet — DB mantığı YOK, hiçbir ekrana bağlı DEĞİL.)
//
// Hedef davranış (mimari kararına bakınız — önceki analiz/tasarım turu):
//   OrderDetail "Tahsilat" formu, Accounting "Gelir Ekle→Sipariş" ve
//   Accounting "Tahsilat" — üçü de İLERİDE bu servisi çağıracak. Bu fazda
//   yalnızca tip/arayüz/iskelet vardır; gerçek insert/update FAZ 2'de eklenir.
// ============================================================================
import type { FinanceServiceDeps } from "./deps";
import type { FinanceResult } from "./results";
import { notImplementedError } from "./errors";
import type { IsoDate, Money, PaymentMethod, TenantContext } from "./types";

export type RecordCollectionParams = TenantContext & {
  orderId: string;
  amount: Money;
  method: PaymentMethod;
  /** Verilmezse "şimdi" kabul edilir. */
  date?: IsoDate;
  note?: string;
  /**
   * Çağıran taraf (UI) tarafından üretilen tekil anahtar (örn. UUID) —
   * çift tıklama / ağ retry senaryosunda aynı tahsilatın iki kez
   * kaydedilmesini engellemek için FAZ 2 implementasyonu bunu kullanır.
   * Verilmezse dedupe uygulanmaz (mevcut/eski davranışla aynı).
   */
  idempotencyKey?: string;
};

export type CollectionRecord = {
  paymentId: string;
  incomeId: string;
  orderId: string;
  amount: Money;
  newPaidAmount: Money;
  newRemainingAmount: Money;
  newStatus: string;
  isOverpayment: boolean;
  overpaymentAmount: Money;
};

export interface CustomerCollectionService {
  recordCollection(params: RecordCollectionParams): Promise<FinanceResult<CollectionRecord>>;
}

/** FAZ 1 stub — gerçek implementasyon FAZ 2'de eklenecek. */
export function createCustomerCollectionService(deps: FinanceServiceDeps): CustomerCollectionService {
  void deps;
  return {
    async recordCollection(params) {
      void params;
      return { status: "error", error: notImplementedError("CustomerCollectionService.recordCollection") };
    },
  };
}
