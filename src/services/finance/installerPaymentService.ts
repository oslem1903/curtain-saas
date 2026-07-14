// ============================================================================
// InstallerPaymentService — montajcı ödemesi için tek giriş noktası.
// (FAZ 2: gerçek implementasyon — hiçbir ekrana HÂLÂ bağlı DEĞİL.)
//
// Yazım stratejisi FAZ 1'de sabitlendi (bkz. decisions.ts::FINANCE_WRITE_STRATEGY
// === "atomic_rpc"): tüm insert/update tek bir Postgres RPC çağrısı içinde,
// tek bir DB transaction'ı olarak yapılır. RPC tanımları:
//   supabase_installer_payment_finance_rpc.sql
//     - installer_record_payment(...)
//     - installer_cancel_payment(...)   ← ters kayıt (reverse entry), hard delete YOK
// Bu SQL dosyası repoya eklendi ama Supabase'e UYGULANMADI — ayrı onay gerekir.
//
// Bu fazda hâlâ hiçbir ekran (.tsx) bu servisi çağırmıyor; eski
// InstallerLedger.tsx (handlePay/cancelPayment) DOKUNULMADAN kendi eski
// insert/update mantığıyla çalışmaya devam ediyor.
// ============================================================================
import type { FinanceServiceDeps } from "./deps";
import { financeFailure, financeSuccess } from "./results";
import type { FinanceResult } from "./results";
import { FinanceError, toFinanceError } from "./errors";
import type { FinanceErrorCode } from "./errors";
import type { IsoDate, Money, PaymentMethod, TenantContext } from "./types";

export type RecordInstallerPaymentParams = TenantContext & {
  installerId: string;
  amount: Money;
  method: PaymentMethod;
  periodStart?: IsoDate | null;
  periodEnd?: IsoDate | null;
  note?: string;
  /**
   * Çağıran taraf (UI) tarafından üretilen tekil anahtar (örn. UUID) —
   * çift tıklama / ağ retry senaryosunda aynı ödemenin iki kez
   * kaydedilmesini engellemek için kullanılır. Aynı anahtarla ikinci çağrı
   * yeni kayıt oluşturmaz; orijinal sonucu (alreadyExisted: true ile) döner.
   * Verilmezse dedupe uygulanmaz (mevcut/eski davranışla aynı).
   */
  idempotencyKey?: string;
};

export type InstallerPaymentRecord = {
  transactionId: string;
  expenseId: string | null;
  installerId: string;
  amount: Money;
  /** Bu ödemeden SONRA, yalnızca bu installerId için hesaplanan kalan bakiye. */
  newBalance: Money;
  /** true ise aynı idempotencyKey ile önceden oluşturulmuş kayıt döndürüldü. */
  alreadyExisted: boolean;
};

export type CancelInstallerPaymentParams = TenantContext & {
  transactionId: string;
  note?: string;
  idempotencyKey?: string;
};

export type CancelInstallerPaymentRecord = {
  /** Yeni oluşturulan 'cancel' (ters kayıt) hareketinin id'si. */
  transactionId: string;
  /** İptal edilen orijinal 'payment' hareketinin id'si. */
  reversedTransactionId: string;
  /** Ters gider kaydının id'si (orijinal ödemenin bağlı gideri yoksa null). */
  expenseId: string | null;
  installerId: string;
  amount: Money;
  newBalance: Money;
  alreadyExisted: boolean;
};

export type AddManualEarningParams = TenantContext & {
  installerId: string;
  amount: Money;
  earningDate: IsoDate;  // YYYY-MM-DD
  description?: string;
  idempotencyKey?: string;
};

export type ManualEarningRecord = {
  earningId: string;
  transactionId: string;
  installerId: string;
  amount: Money;
  balance: Money;
  alreadyExisted: boolean;
};

export interface InstallerPaymentService {
  recordPayment(params: RecordInstallerPaymentParams): Promise<FinanceResult<InstallerPaymentRecord>>;
  cancelPayment(params: CancelInstallerPaymentParams): Promise<FinanceResult<CancelInstallerPaymentRecord>>;
  addManualEarning(params: AddManualEarningParams): Promise<FinanceResult<ManualEarningRecord>>;
}

// ----------------------------------------------------------------------------
// RPC ham yanıt şekilleri (snake_case — Postgres jsonb_build_object çıktısı).
// ----------------------------------------------------------------------------
type RecordPaymentRpcResponse = {
  transaction_id: string;
  expense_id: string | null;
  installer_id: string;
  amount: number;
  new_balance: number;
  already_existed: boolean;
};

type CancelPaymentRpcResponse = {
  transaction_id: string;
  reversed_transaction_id: string;
  expense_id: string | null;
  installer_id: string;
  amount: number;
  new_balance: number;
  already_existed: boolean;
};

type AddManualEarningRpcResponse = {
  earning_id: string;
  transaction_id: string;
  installer_id: string;
  amount: number;
  balance: number;
  already_existed: boolean;
  status: string;
};

function mapRecordResponse(r: RecordPaymentRpcResponse): InstallerPaymentRecord {
  return {
    transactionId: r.transaction_id,
    expenseId: r.expense_id,
    installerId: r.installer_id,
    amount: Number(r.amount),
    newBalance: Number(r.new_balance),
    alreadyExisted: r.already_existed,
  };
}

function mapCancelResponse(r: CancelPaymentRpcResponse): CancelInstallerPaymentRecord {
  return {
    transactionId: r.transaction_id,
    reversedTransactionId: r.reversed_transaction_id,
    expenseId: r.expense_id,
    installerId: r.installer_id,
    amount: Number(r.amount),
    newBalance: Number(r.new_balance),
    alreadyExisted: r.already_existed,
  };
}

function mapManualEarningResponse(r: AddManualEarningRpcResponse): ManualEarningRecord {
  return {
    earningId: r.earning_id,
    transactionId: r.transaction_id,
    installerId: r.installer_id,
    amount: Number(r.amount),
    balance: Number(r.balance),
    alreadyExisted: r.already_existed,
  };
}

// ----------------------------------------------------------------------------
// Tek nokta hata yönetimi — hem recordPayment hem cancelPayment aynı
// parser'dan geçer. RPC tarafı hataları `"<code>: <mesaj>"` biçiminde
// (bkz. supabase_installer_payment_finance_rpc.sql RAISE EXCEPTION satırları)
// fırlatır; burada FinanceErrorCode'a geri eşlenir.
// ----------------------------------------------------------------------------
const KNOWN_RPC_ERROR_CODES: FinanceErrorCode[] = [
  "invalid_amount",
  "invalid_reference",
  "not_found",
  "overpayment_blocked",
  "unauthorized",
];

function parseInstallerRpcError(raw: unknown): FinanceError {
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

export function createInstallerPaymentService(deps: FinanceServiceDeps): InstallerPaymentService {
  async function callRpc<T>(fnName: string, args: Record<string, unknown>): Promise<FinanceResult<T>> {
    try {
      const { data, error } = await deps.supabase.rpc(fnName, args);
      if (error) return financeFailure(parseInstallerRpcError(error));
      return financeSuccess(data as T);
    } catch (e) {
      return financeFailure(parseInstallerRpcError(e));
    }
  }

  return {
    async recordPayment(params) {
      if (!params.installerId) {
        return financeFailure(new FinanceError("invalid_reference", "installerId gerekli."));
      }
      if (!Number.isFinite(params.amount) || params.amount <= 0) {
        return financeFailure(new FinanceError("invalid_amount", "Tutar sıfırdan büyük olmalı."));
      }

      const rpcResult = await callRpc<RecordPaymentRpcResponse>("installer_record_payment", {
        p_company_id: params.companyId,
        p_installer_id: params.installerId,
        p_amount: params.amount,
        p_payment_method: params.method ?? null,
        p_period_start: params.periodStart ?? null,
        p_period_end: params.periodEnd ?? null,
        p_note: params.note ?? null,
        p_idempotency_key: params.idempotencyKey ?? null,
      });

      if (rpcResult.status !== "success") return rpcResult;
      return financeSuccess(mapRecordResponse(rpcResult.data));
    },

    async cancelPayment(params) {
      if (!params.transactionId) {
        return financeFailure(new FinanceError("invalid_reference", "transactionId gerekli."));
      }

      const rpcResult = await callRpc<CancelPaymentRpcResponse>("installer_cancel_payment", {
        p_company_id: params.companyId,
        p_transaction_id: params.transactionId,
        p_note: params.note ?? null,
        p_idempotency_key: params.idempotencyKey ?? null,
      });

      if (rpcResult.status !== "success") return rpcResult;
      return financeSuccess(mapCancelResponse(rpcResult.data));
    },

    async addManualEarning(params) {
      if (!params.installerId) {
        return financeFailure(new FinanceError("invalid_reference", "installerId gerekli."));
      }
      if (!Number.isFinite(params.amount) || params.amount <= 0) {
        return financeFailure(new FinanceError("invalid_amount", "Tutar sıfırdan büyük olmalı."));
      }
      if (!params.earningDate) {
        return financeFailure(new FinanceError("invalid_reference", "Tarih gerekli."));
      }

      const rpcResult = await callRpc<AddManualEarningRpcResponse>("add_manual_installer_earning", {
        p_company_id: params.companyId,
        p_installer_id: params.installerId,
        p_amount: params.amount,
        p_earning_date: params.earningDate,
        p_description: params.description ?? null,
        p_idempotency_key: params.idempotencyKey ?? null,
      });

      if (rpcResult.status !== "success") return rpcResult;
      return financeSuccess(mapManualEarningResponse(rpcResult.data));
    },
  };
}
