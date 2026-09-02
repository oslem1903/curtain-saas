// ============================================================================
// CustomerInstallmentService — order_payment_plans/order_installments icin
// atomik RPC katmani (create_order_installment_plan / rebuild_order_installment_plan
// / cancel_order_installment_plan).
//
// customer_record_collection / customer_cancel_collection'a HIC dokunmaz —
// tahsilat kaydi/iptali her zaman CustomerCollectionService uzerinden devam
// eder. Bu servis yalnizca "hangi taksitler ne zaman odenecek" PLANINI
// yonetir; taksit odenmis/kismi/bekliyor/gecikmis durumu ayrica
// src/utils/installments.ts ile canli ledger'dan turetilir.
// ============================================================================
import type { FinanceServiceDeps } from "./deps";
import { financeFailure, financeSuccess } from "./results";
import type { FinanceResult } from "./results";
import { FinanceError, toFinanceError } from "./errors";
import type { FinanceErrorCode } from "./errors";
import type { IsoDate, Money, TenantContext } from "./types";

export type InstallmentInput = {
  installmentNo: number;
  amount: Money;
  dueDate: IsoDate;
};

export type CreatePlanParams = TenantContext & {
  orderId: string;
  installments: InstallmentInput[];
};

export type RebuildPlanParams = CreatePlanParams;

export type CancelPlanParams = TenantContext & {
  orderId: string;
};

export type PlanRecord = {
  planId: string;
  orderId: string;
  installmentCount: number;
  openingTotalAmount: Money;
  openingPaidAmount: Money;
  openingRemainingAmount: Money;
  baselineReset?: boolean;
};

export type CancelPlanRecord = {
  planId: string;
  orderId: string;
  status: string;
};

export interface CustomerInstallmentService {
  createPlan(params: CreatePlanParams): Promise<FinanceResult<PlanRecord>>;
  rebuildPlan(params: RebuildPlanParams): Promise<FinanceResult<PlanRecord>>;
  cancelPlan(params: CancelPlanParams): Promise<FinanceResult<CancelPlanRecord>>;
}

type PlanRpcResponse = {
  success: boolean;
  plan_id: string;
  order_id: string;
  installment_count: number;
  opening_total_amount: number;
  opening_paid_amount: number;
  opening_remaining_amount: number;
  baseline_reset?: boolean;
};

type CancelRpcResponse = {
  success: boolean;
  plan_id: string;
  order_id: string;
  status: string;
};

function mapPlanResponse(r: PlanRpcResponse): PlanRecord {
  return {
    planId: r.plan_id,
    orderId: r.order_id,
    installmentCount: r.installment_count,
    openingTotalAmount: Number(r.opening_total_amount),
    openingPaidAmount: Number(r.opening_paid_amount),
    openingRemainingAmount: Number(r.opening_remaining_amount),
    baselineReset: r.baseline_reset,
  };
}

function mapCancelResponse(r: CancelRpcResponse): CancelPlanRecord {
  return { planId: r.plan_id, orderId: r.order_id, status: r.status };
}

// RPC tarafi hatalari "<code>: <mesaj>" biçiminde firlatir (bkz.
// supabase_migration_010_order_installments_rpc.sql RAISE EXCEPTION satirlari).
const KNOWN_RPC_ERROR_CODES: FinanceErrorCode[] = [
  "invalid_amount",
  "invalid_reference",
  "invalid_installments",
  "not_found",
  "plan_exists",
  "unauthorized",
];

function parsePlanRpcError(raw: unknown): FinanceError {
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

function toInstallmentsPayload(installments: InstallmentInput[]) {
  return installments.map((i) => ({
    installment_no: i.installmentNo,
    amount: i.amount,
    due_date: i.dueDate,
  }));
}

export function createCustomerInstallmentService(deps: FinanceServiceDeps): CustomerInstallmentService {
  async function callRpc<T>(fnName: string, args: Record<string, unknown>): Promise<FinanceResult<T>> {
    try {
      const { data, error } = await deps.supabase.rpc(fnName, args);
      if (error) return financeFailure(parsePlanRpcError(error));
      return financeSuccess(data as T);
    } catch (e) {
      return financeFailure(parsePlanRpcError(e));
    }
  }

  return {
    async createPlan(params) {
      if (!params.orderId) {
        return financeFailure(new FinanceError("invalid_reference", "orderId gerekli."));
      }
      if (!params.installments || params.installments.length === 0) {
        return financeFailure(new FinanceError("invalid_installments", "En az 1 taksit girilmeli."));
      }

      const rpcResult = await callRpc<PlanRpcResponse>("create_order_installment_plan", {
        p_company_id: params.companyId,
        p_order_id: params.orderId,
        p_installments: toInstallmentsPayload(params.installments),
      });

      if (rpcResult.status !== "success") return rpcResult;
      return financeSuccess(mapPlanResponse(rpcResult.data));
    },

    async rebuildPlan(params) {
      if (!params.orderId) {
        return financeFailure(new FinanceError("invalid_reference", "orderId gerekli."));
      }
      if (!params.installments || params.installments.length === 0) {
        return financeFailure(new FinanceError("invalid_installments", "En az 1 taksit girilmeli."));
      }

      const rpcResult = await callRpc<PlanRpcResponse>("rebuild_order_installment_plan", {
        p_company_id: params.companyId,
        p_order_id: params.orderId,
        p_installments: toInstallmentsPayload(params.installments),
      });

      if (rpcResult.status !== "success") return rpcResult;
      return financeSuccess(mapPlanResponse(rpcResult.data));
    },

    async cancelPlan(params) {
      if (!params.orderId) {
        return financeFailure(new FinanceError("invalid_reference", "orderId gerekli."));
      }

      const rpcResult = await callRpc<CancelRpcResponse>("cancel_order_installment_plan", {
        p_company_id: params.companyId,
        p_order_id: params.orderId,
      });

      if (rpcResult.status !== "success") return rpcResult;
      return financeSuccess(mapCancelResponse(rpcResult.data));
    },
  };
}
