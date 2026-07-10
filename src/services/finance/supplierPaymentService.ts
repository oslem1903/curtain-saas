// ============================================================================
// SupplierPaymentService — tedarikçi ödemesi için tek giriş noktası.
// (FAZ 3: gerçek implementasyon — hiçbir ekrana HÂLÂ bağlı DEĞİL.)
//
// Yazım stratejisi FAZ 1'de sabitlendi (bkz. decisions.ts::FINANCE_WRITE_STRATEGY
// === "atomic_rpc"): tüm insert/update tek bir Postgres RPC çağrısı içinde,
// tek bir DB transaction'ı olarak yapılır. RPC tanımları:
//   supabase_supplier_payment_finance_rpc.sql
//     - supplier_record_payment(...)
//     - supplier_cancel_payment(...)   ← ters kayıt (reverse entry), hard delete YOK
// Bu SQL dosyası repoya eklendi ama Supabase'e UYGULANMADI — ayrı onay gerekir.
//
// ÖNEMLİ KARAR: ödeme iptali transaction_type olarak 'cancel' KULLANMAZ —
// mevcut sistemde 'cancel' zaten farklı bir anlam taşıyor (sipariş kalemi
// maliyeti düştüğünde / tedarikçi değiştiğinde borç azaltma; bkz.
// src/pages/OrderDetail.tsx, DOKUNULMADI). Bunun yerine yeni bir tip
// kullanılır: 'payment_reversal'. Bu servisin döndürdüğü kayıtlarda
// "reversedTransactionId" bu ayrımı taşır.
//
// Bu fazda hâlâ hiçbir ekran (.tsx) bu servisi çağırmıyor; eski
// SupplierDetail.tsx / SupplierLedger.tsx / Accounting.tsx::saveSupplierPayment
// DOKUNULMADAN kendi eski insert/update mantığıyla çalışmaya devam ediyor.
// src/utils/supplierCari.ts (borç oluşturma, 'debt' tipi) de DOKUNULMADI.
// ============================================================================
import type { FinanceServiceDeps } from "./deps";
import { financeFailure, financeSuccess } from "./results";
import type { FinanceResult } from "./results";
import { FinanceError, toFinanceError } from "./errors";
import type { FinanceErrorCode } from "./errors";
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
   * kaydedilmesini engellemek için kullanılır. Aynı anahtarla ikinci çağrı
   * yeni kayıt oluşturmaz; orijinal sonucu (alreadyExisted: true ile) döner.
   * Verilmezse dedupe uygulanmaz (mevcut/eski davranışla aynı).
   */
  idempotencyKey?: string;
  /** Ödemenin tarihi (ISO 8601 timestamp). Verilmezse now() kullanılır. */
  paymentDate?: string; // ISO 8601 timestamp
  /** Tedarikçinin bir borç satırının due_date'ini güncelle. */
  updateDueDate?: boolean;
  /** Güncelleme yapılırsa, yeni due_date değeri (ISO 8601 date). */
  newDueDate?: string | null; // ISO 8601 date (YYYY-MM-DD)
};

export type SupplierPaymentRecord = {
  transactionId: string;
  expenseId: string | null;
  supplierId: string;
  amount: Money;
  /** Bu ödemeden SONRA hesaplanan bakiye. Negatifse fazla ödeme/alacak
   * anlamına gelir — bu RPC bakiyeyi 0'da KIRPMAZ (bkz. SQL dosyası notu). */
  newBalance: Money;
  /** true ise aynı idempotencyKey ile önceden oluşturulmuş kayıt döndürüldü. */
  alreadyExisted: boolean;
};

export type CancelSupplierPaymentParams = TenantContext & {
  transactionId: string;
  note?: string;
  idempotencyKey?: string;
};

export type CancelSupplierPaymentRecord = {
  /** Yeni oluşturulan 'payment_reversal' (ters kayıt) hareketinin id'si. */
  transactionId: string;
  /** İptal edilen orijinal 'payment' hareketinin id'si. */
  reversedTransactionId: string;
  /** Ters gider kaydının id'si (orijinal ödemenin bağlı gideri yoksa null). */
  expenseId: string | null;
  supplierId: string;
  amount: Money;
  newBalance: Money;
  alreadyExisted: boolean;
};

export interface SupplierPaymentService {
  recordPayment(params: RecordSupplierPaymentParams): Promise<FinanceResult<SupplierPaymentRecord>>;
  cancelPayment(params: CancelSupplierPaymentParams): Promise<FinanceResult<CancelSupplierPaymentRecord>>;
}

// ----------------------------------------------------------------------------
// RPC ham yanıt şekilleri (snake_case — Postgres jsonb_build_object çıktısı).
// ----------------------------------------------------------------------------
type RecordPaymentRpcResponse = {
  transaction_id: string;
  expense_id: string | null;
  supplier_id: string;
  amount: number;
  new_balance: number;
  already_existed: boolean;
};

type CancelPaymentRpcResponse = {
  transaction_id: string;
  reversed_transaction_id: string;
  expense_id: string | null;
  supplier_id: string;
  amount: number;
  new_balance: number;
  already_existed: boolean;
};

function mapRecordResponse(r: RecordPaymentRpcResponse): SupplierPaymentRecord {
  return {
    transactionId: r.transaction_id,
    expenseId: r.expense_id,
    supplierId: r.supplier_id,
    amount: Number(r.amount),
    newBalance: Number(r.new_balance),
    alreadyExisted: r.already_existed,
  };
}

function mapCancelResponse(r: CancelPaymentRpcResponse): CancelSupplierPaymentRecord {
  return {
    transactionId: r.transaction_id,
    reversedTransactionId: r.reversed_transaction_id,
    expenseId: r.expense_id,
    supplierId: r.supplier_id,
    amount: Number(r.amount),
    newBalance: Number(r.new_balance),
    alreadyExisted: r.already_existed,
  };
}

// ----------------------------------------------------------------------------
// Tek nokta hata yönetimi — hem recordPayment hem cancelPayment aynı
// parser'dan geçer. RPC tarafı hataları `"<code>: <mesaj>"` biçiminde
// (bkz. supabase_supplier_payment_finance_rpc.sql RAISE EXCEPTION satırları)
// fırlatır; burada FinanceErrorCode'a geri eşlenir.
// ----------------------------------------------------------------------------
const KNOWN_RPC_ERROR_CODES: FinanceErrorCode[] = [
  "invalid_amount",
  "invalid_reference",
  "not_found",
  "overpayment_blocked",
  "unauthorized",
];

function parseSupplierRpcError(raw: unknown): FinanceError {
  if (raw instanceof FinanceError) return raw;
  const message =
    typeof raw === "object" && raw !== null && "message" in raw && typeof (raw as { message: unknown }).message === "string"
      ? (raw as { message: string }).message
      : "";
  const matchedCode = KNOWN_RPC_ERROR_CODES.find((code) => message.startsWith(`${code}:`));
  if (matchedCode) {
    return new FinanceError(matchedCode, message.slice(matchedCode.length + 1).trim(), raw);
  }
  return toFinanceError(raw, "db_error");
}

export function createSupplierPaymentService(deps: FinanceServiceDeps): SupplierPaymentService {
  async function callRpc<T>(fnName: string, args: Record<string, unknown>): Promise<FinanceResult<T>> {
    try {
      const { data, error } = await deps.supabase.rpc(fnName, args);
      if (error) return financeFailure(parseSupplierRpcError(error));
      return financeSuccess(data as T);
    } catch (e) {
      return financeFailure(parseSupplierRpcError(e));
    }
  }

  return {
    async recordPayment(params) {
      if (!params.supplierId) {
        return financeFailure(new FinanceError("invalid_reference", "supplierId gerekli."));
      }
      if (!Number.isFinite(params.amount) || params.amount <= 0) {
        return financeFailure(new FinanceError("invalid_amount", "Tutar sıfırdan büyük olmalı."));
      }

      const rpcResult = await callRpc<RecordPaymentRpcResponse>("supplier_record_payment", {
        p_company_id: params.companyId,
        p_supplier_id: params.supplierId,
        p_amount: params.amount,
        p_payment_method: params.method ?? null,
        p_note: params.note ?? null,
        p_order_id: params.orderId ?? null,
        p_idempotency_key: params.idempotencyKey ?? null,
        p_payment_date: params.paymentDate ?? null,
        p_update_due_date: params.updateDueDate ?? false,
        p_new_due_date: params.newDueDate ?? null,
      });

      if (rpcResult.status !== "success") return rpcResult;
      return financeSuccess(mapRecordResponse(rpcResult.data));
    },

    async cancelPayment(params) {
      if (!params.transactionId) {
        return financeFailure(new FinanceError("invalid_reference", "transactionId gerekli."));
      }

      const rpcResult = await callRpc<CancelPaymentRpcResponse>("supplier_cancel_payment", {
        p_company_id: params.companyId,
        p_transaction_id: params.transactionId,
        p_note: params.note ?? null,
        p_idempotency_key: params.idempotencyKey ?? null,
      });

      if (rpcResult.status !== "success") return rpcResult;
      return financeSuccess(mapCancelResponse(rpcResult.data));
    },
  };
}
