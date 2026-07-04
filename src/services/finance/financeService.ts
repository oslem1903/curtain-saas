// ============================================================================
// FinanceService — üç finans servisinin tek giriş noktası (facade).
// (FAZ 1: yalnızca iskelet — hiçbir ekrana bağlı DEĞİL.)
//
// İleride bir ekran finans işlemi yapacağı zaman tek bir şeyi import eder:
//   const finance = createFinanceService();
//   await finance.customerCollections.recordCollection({ ... });
//   await finance.supplierPayments.recordPayment({ ... });
//   await finance.installerPayments.recordPayment({ ... });
//
// NOT (isimlendirme): Bu tip önceki incelemede "FinancialService" olarak
// adlandırılmıştı; modüldeki diğer her şeyle (FinanceError, FinanceResult,
// FinanceServiceDeps) tutarlı olması için "FinanceService" olarak
// yeniden adlandırıldı.
// ============================================================================
import { createDefaultFinanceServiceDeps } from "./deps";
import type { FinanceServiceDeps } from "./deps";
import { createCustomerCollectionService } from "./customerCollectionService";
import type { CustomerCollectionService } from "./customerCollectionService";
import { createSupplierPaymentService } from "./supplierPaymentService";
import type { SupplierPaymentService } from "./supplierPaymentService";
import { createInstallerPaymentService } from "./installerPaymentService";
import type { InstallerPaymentService } from "./installerPaymentService";

export interface FinanceService {
  customerCollections: CustomerCollectionService;
  supplierPayments: SupplierPaymentService;
  installerPayments: InstallerPaymentService;
}

/**
 * FinanceService oluşturur. `deps` verilmezse mevcut uygulamanın paylaşılan
 * supabase client'ı kullanılır (mevcut davranışla birebir aynı bağlantı).
 */
export function createFinanceService(deps: FinanceServiceDeps = createDefaultFinanceServiceDeps()): FinanceService {
  return {
    customerCollections: createCustomerCollectionService(deps),
    supplierPayments: createSupplierPaymentService(deps),
    installerPayments: createInstallerPaymentService(deps),
  };
}
