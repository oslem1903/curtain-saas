// ============================================================================
// Finans servisleri için ortak Result modeli (FAZ 1: yalnızca altyapı).
//
// Mevcut src/utils/supplierCari.ts::PostSupplierDebtResult deseninin
// genellenmiş hâli. Her finans servisi (tahsilat/tedarikçi ödemesi/montajcı
// ödemesi) bu şekli döner; çağıran taraf tek bir if/switch zinciriyle tüm
// servisleri aynı şekilde ele alabilir.
//
// NOT: supplierCari.ts'e DOKUNULMADI — o modül kendi Result tipini (inserted/
// skipped/error) korumaya devam ediyor. Bu, yeni servis katmanı için ayrı
// ve genellenmiş bir modeldir.
// ============================================================================
import type { FinanceError } from "./errors";

export type FinanceSuccess<T> = {
  status: "success";
  data: T;
};

export type FinanceSkipped = {
  status: "skipped";
  reason: string;
};

export type FinanceFailure = {
  status: "error";
  error: FinanceError;
};

export type FinanceResult<T> = FinanceSuccess<T> | FinanceSkipped | FinanceFailure;

export function financeSuccess<T>(data: T): FinanceResult<T> {
  return { status: "success", data };
}

export function financeSkipped<T = never>(reason: string): FinanceResult<T> {
  return { status: "skipped", reason };
}

export function financeFailure<T = never>(error: FinanceError): FinanceResult<T> {
  return { status: "error", error };
}
