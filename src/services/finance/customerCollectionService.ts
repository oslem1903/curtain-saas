// ============================================================================
// CustomerCollectionService — tahsilat için tek giriş noktası.
// (FAZ 4: gerçek implementasyon — hiçbir ekrana HÂLÂ bağlı DEĞİL.)
//
// Yazım stratejisi FAZ 1'de sabitlendi (bkz. decisions.ts::FINANCE_WRITE_STRATEGY
// === "atomic_rpc"): tüm insert/update tek bir Postgres RPC çağrısı içinde,
// tek bir DB transaction'ı olarak yapılır. RPC tanımları:
//   supabase_customer_collection_finance_rpc.sql
//     - customer_record_collection(...)
//     - customer_cancel_collection(...)   ← ters kayıt (reverse entry), hard delete YOK
// Bu SQL dosyası repoya eklendi ama Supabase'e UYGULANMADI — ayrı onay gerekir.
//
// ARAŞTIRMA SIRASINDA BULUNAN ÖNEMLİ NOKTALAR (bkz. SQL dosyasının başı):
//   - payments/income tabloları "accounting only" RLS ile kurulu
//     (public.is_company_accounting(company_id) şartı) — bu yüzden RPC'ler
//     my_company_ids()/is_super_admin() + check_subscription_active()'e EK
//     olarak is_company_accounting() kontrolü de yapıyor.
//   - orders.status kolonu MEVCUT kodda iki farklı amaç için kullanılıyor
//     (iş akışı durumu VE Accounting.tsx::saveIncome()'un "paid/partial/open"
//     etiketleri) — bu RPC'ler bilinçli olarak orders.status'A DOKUNMAZ,
//     yalnızca paid_amount/remaining_amount günceller. Hesaplanan ödeme
//     durumu (`newStatus`) yalnızca bilgi amaçlı döner, DB'ye yazılmaz.
//   - Fazla tahsilat OrderDetail.tsx'teki en eksiksiz davranışla (kabul et +
//     bilgi olarak işaretle) uyumlu tutuldu; tek bir politika kararı henüz
//     verilmedi (bkz. mimari inceleme) — bu servis hiçbir politikayı
//     "düzeltmeye" çalışmıyor.
//
// Bu fazda hâlâ hiçbir ekran (.tsx) bu servisi çağırmıyor; eski
// OrderDetail.tsx "Tahsilat" formu / Accounting.tsx::saveIncome /
// Accounting.tsx::saveCollection DOKUNULMADAN kendi eski insert/update
// mantığıyla çalışmaya devam ediyor.
// ============================================================================
import type { FinanceServiceDeps } from "./deps";
import { financeFailure, financeSuccess } from "./results";
import type { FinanceResult } from "./results";
import { FinanceError, toFinanceError } from "./errors";
import type { FinanceErrorCode } from "./errors";
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
   * kaydedilmesini engellemek için kullanılır. Aynı anahtarla ikinci çağrı
   * yeni kayıt oluşturmaz; orijinal sonucu (alreadyExisted: true ile) döner.
   * Verilmezse dedupe uygulanmaz (mevcut/eski davranışla aynı).
   */
  idempotencyKey?: string;
};

export type CollectionRecord = {
  paymentId: string;
  incomeId: string | null;
  orderId: string;
  amount: Money;
  newPaidAmount: Money;
  newRemainingAmount: Money;
  /** Yalnızca bilgi amaçlı ("paid"/"partial"/"open") — orders.status'a YAZILMAZ. */
  newStatus: string;
  isOverpayment: boolean;
  overpaymentAmount: Money;
  /** true ise aynı idempotencyKey ile önceden oluşturulmuş kayıt döndürüldü. */
  alreadyExisted: boolean;
};

export type CancelCollectionParams = TenantContext & {
  paymentId: string;
  note?: string;
  idempotencyKey?: string;
};

export type CancelCollectionRecord = {
  /** Yeni oluşturulan ters kayıt (iptal) hareketinin id'si. */
  paymentId: string;
  /** İptal edilen orijinal tahsilat hareketinin id'si. */
  reversedPaymentId: string;
  /** Ters gelir kaydının id'si (orijinal tahsilatın bağlı geliri yoksa null). */
  incomeId: string | null;
  orderId: string;
  amount: Money;
  newPaidAmount: Money;
  newRemainingAmount: Money;
  newStatus: string;
  isOverpayment: boolean;
  overpaymentAmount: Money;
  alreadyExisted: boolean;
};

export interface CustomerCollectionService {
  recordCollection(params: RecordCollectionParams): Promise<FinanceResult<CollectionRecord>>;
  cancelCollection(params: CancelCollectionParams): Promise<FinanceResult<CancelCollectionRecord>>;
}

// ----------------------------------------------------------------------------
// RPC ham yanıt şekilleri (snake_case — Postgres jsonb_build_object çıktısı).
// ----------------------------------------------------------------------------
type RecordCollectionRpcResponse = {
  payment_id: string;
  income_id: string | null;
  order_id: string;
  amount: number;
  new_paid_amount: number;
  new_remaining_amount: number;
  new_status: string;
  is_overpayment: boolean;
  overpayment_amount: number;
  already_existed: boolean;
};

type CancelCollectionRpcResponse = {
  payment_id: string;
  reversed_payment_id: string;
  income_id: string | null;
  order_id: string;
  amount: number;
  new_paid_amount: number;
  new_remaining_amount: number;
  new_status: string;
  is_overpayment: boolean;
  overpayment_amount: number;
  already_existed: boolean;
};

function mapRecordResponse(r: RecordCollectionRpcResponse): CollectionRecord {
  return {
    paymentId: r.payment_id,
    incomeId: r.income_id,
    orderId: r.order_id,
    amount: Number(r.amount),
    newPaidAmount: Number(r.new_paid_amount),
    newRemainingAmount: Number(r.new_remaining_amount),
    newStatus: r.new_status,
    isOverpayment: r.is_overpayment,
    overpaymentAmount: Number(r.overpayment_amount),
    alreadyExisted: r.already_existed,
  };
}

function mapCancelResponse(r: CancelCollectionRpcResponse): CancelCollectionRecord {
  return {
    paymentId: r.payment_id,
    reversedPaymentId: r.reversed_payment_id,
    incomeId: r.income_id,
    orderId: r.order_id,
    amount: Number(r.amount),
    newPaidAmount: Number(r.new_paid_amount),
    newRemainingAmount: Number(r.new_remaining_amount),
    newStatus: r.new_status,
    isOverpayment: r.is_overpayment,
    overpaymentAmount: Number(r.overpayment_amount),
    alreadyExisted: r.already_existed,
  };
}

// ----------------------------------------------------------------------------
// Tek nokta hata yönetimi — hem recordCollection hem cancelCollection aynı
// parser'dan geçer. RPC tarafı hataları `"<code>: <mesaj>"` biçiminde
// (bkz. supabase_customer_collection_finance_rpc.sql RAISE EXCEPTION
// satırları) fırlatır; burada FinanceErrorCode'a geri eşlenir.
// ----------------------------------------------------------------------------
const KNOWN_RPC_ERROR_CODES: FinanceErrorCode[] = [
  "invalid_amount",
  "invalid_reference",
  "not_found",
  "overpayment_blocked",
  "unauthorized",
];

function parseCollectionRpcError(raw: unknown): FinanceError {
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

export function createCustomerCollectionService(deps: FinanceServiceDeps): CustomerCollectionService {
  async function callRpc<T>(fnName: string, args: Record<string, unknown>): Promise<FinanceResult<T>> {
    try {
      const { data, error } = await deps.supabase.rpc(fnName, args);
      if (error) return financeFailure(parseCollectionRpcError(error));
      return financeSuccess(data as T);
    } catch (e) {
      return financeFailure(parseCollectionRpcError(e));
    }
  }

  return {
    async recordCollection(params) {
      if (!params.orderId) {
        return financeFailure(new FinanceError("invalid_reference", "orderId gerekli."));
      }
      if (!Number.isFinite(params.amount) || params.amount <= 0) {
        return financeFailure(new FinanceError("invalid_amount", "Tutar sıfırdan büyük olmalı."));
      }

      const rpcResult = await callRpc<RecordCollectionRpcResponse>("customer_record_collection", {
        p_company_id: params.companyId,
        p_order_id: params.orderId,
        p_amount: params.amount,
        p_payment_method: params.method ?? null,
        p_note: params.note ?? null,
        p_collection_date: params.date ?? null,
        p_idempotency_key: params.idempotencyKey ?? null,
      });

      if (rpcResult.status !== "success") return rpcResult;
      return financeSuccess(mapRecordResponse(rpcResult.data));
    },

    async cancelCollection(params) {
      if (!params.paymentId) {
        return financeFailure(new FinanceError("invalid_reference", "paymentId gerekli."));
      }

      const rpcResult = await callRpc<CancelCollectionRpcResponse>("customer_cancel_collection", {
        p_company_id: params.companyId,
        p_payment_id: params.paymentId,
        p_note: params.note ?? null,
        p_idempotency_key: params.idempotencyKey ?? null,
      });

      if (rpcResult.status !== "success") return rpcResult;
      return financeSuccess(mapCancelResponse(rpcResult.data));
    },
  };
}
