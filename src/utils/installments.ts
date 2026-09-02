// ============================================================================
// order_payment_plans / order_installments — ortak hesaplama katmani.
//
// Kural: taksit durumu HICBIR YERDE ayrica saklanmaz; her zaman canli
// `payments` ledger'i (customer_record_collection/customer_cancel_collection
// tarafindan bakimi yapilan) ile planin acilis anindaki baseline'i
// (opening_paid_amount) arasindaki farktan FIFO olarak turetilir:
//
//   paid_since_plan = live_net_paid(payments) - plan.opening_paid_amount
//
// Bu deger negatifse (plan ONCESI bir tahsilat sonradan iptal edildiyse
// olur), FIFO dagitimi YAPILMAZ — plan "inconsistent" olarak isaretlenir,
// UI acik uyari gostermeli (sessizce yanlis bakiye uretmemek icin).
//
// customer_record_collection / customer_cancel_collection'a bu dosyada HIC
// dokunulmaz, yalnizca sonuclari (payments satirlari) okunur.
// ============================================================================

export type PlanStatus = "active" | "cancelled";

export type OrderPaymentPlan = {
  id: string;
  order_id: string;
  opening_total_amount: number;
  opening_paid_amount: number;
  opening_remaining_amount: number;
  status: PlanStatus;
};

export type OrderInstallment = {
  id: string;
  plan_id: string;
  order_id: string;
  installment_no: number;
  amount: number;
  due_date: string; // YYYY-MM-DD
};

export type LedgerPayment = {
  order_id?: string;
  amount: number | null;
  reverses_payment_id?: string | null;
};

export type InstallmentStatus = "paid" | "partial" | "pending" | "overdue";

export type ComputedInstallment = OrderInstallment & {
  allocatedPaid: number;
  remainingAmount: number;
  status: InstallmentStatus;
  /** Negatifse gecmis (gecikme), pozitifse vadeye kalan gun sayisi. */
  daysUntilDue: number;
};

export type PlanComputation = {
  plan: OrderPaymentPlan;
  installments: ComputedInstallment[];
  liveNetPaid: number;
  paidSincePlan: number;
  /** orders.total_amount, planin opening_total_amount'indan sapmis mi. */
  isStale: boolean;
  /** paidSincePlan negatif mi (plan-oncesi tahsilat sonradan iptal edilmis). */
  isInconsistent: boolean;
};

export function todayDateOnly(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** customer_record_collection/customer_cancel_collection ile ayni, production'da
 * dogrulanmis formul. */
export function computeLiveNetPaid(payments: LedgerPayment[]): number {
  return payments.reduce((sum, p) => {
    const amt = Number(p.amount ?? 0);
    return sum + (p.reverses_payment_id ? -amt : amt);
  }, 0);
}

function daysBetween(fromStr: string, toStr: string): number {
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** Tek bir siparisin plani + taksitlerini, canli ledger'a gore hesaplar. */
export function computePlanForOrder(
  plan: OrderPaymentPlan,
  installments: OrderInstallment[],
  orderPayments: LedgerPayment[],
  liveOrderTotalAmount: number,
  todayStr: string = todayDateOnly(),
): PlanComputation {
  const liveNetPaid = computeLiveNetPaid(orderPayments);
  const paidSincePlan = liveNetPaid - Number(plan.opening_paid_amount ?? 0);
  const isStale = Math.abs(Number(liveOrderTotalAmount ?? 0) - Number(plan.opening_total_amount ?? 0)) > 0.01;
  const isInconsistent = paidSincePlan < -0.01;

  const sorted = [...installments].sort(
    (a, b) => a.due_date.localeCompare(b.due_date) || a.installment_no - b.installment_no,
  );

  let toAllocate = isInconsistent ? 0 : Math.max(paidSincePlan, 0);
  const computed: ComputedInstallment[] = sorted.map((inst) => {
    const amount = Number(inst.amount ?? 0);
    const allocated = Math.min(toAllocate, amount);
    toAllocate -= allocated;
    const remainingAmount = Math.max(amount - allocated, 0);
    const daysUntilDue = daysBetween(todayStr, inst.due_date);
    let status: InstallmentStatus;
    if (remainingAmount <= 0.01) status = "paid";
    else if (allocated > 0.01) status = "partial";
    else if (daysUntilDue < 0) status = "overdue";
    else status = "pending";
    return { ...inst, allocatedPaid: allocated, remainingAmount, status, daysUntilDue };
  });

  return { plan, installments: computed, liveNetPaid, paidSincePlan, isStale, isInconsistent };
}

export type DashboardDueRow = {
  orderId: string;
  planId: string;
  installmentNo: number;
  totalInstallments: number;
  remainingAmount: number;
  dueDate: string;
  status: "pending" | "partial" | "overdue";
  daysUntilDue: number;
  isInconsistent: boolean;
};

/**
 * Birden fazla plani birden hesaplar (Dashboard/Accounting/NotificationBell
 * icin) — yalnizca odenmemis (pending/partial/overdue) taksitleri dondurur.
 * "paid" taksitler listede yer almaz. `plans` cagiran tarafca zaten
 * status==='active' olarak filtrelenmis olmali.
 */
export function buildDashboardDueRows(
  plans: OrderPaymentPlan[],
  installmentsByPlan: Record<string, OrderInstallment[]>,
  paymentsByOrder: Record<string, LedgerPayment[]>,
  orderTotalsByOrder: Record<string, number>,
  todayStr: string = todayDateOnly(),
): { rows: DashboardDueRow[]; staleOrderIds: Set<string>; inconsistentOrderIds: Set<string> } {
  const rows: DashboardDueRow[] = [];
  const staleOrderIds = new Set<string>();
  const inconsistentOrderIds = new Set<string>();

  for (const plan of plans) {
    const installments = installmentsByPlan[plan.id] ?? [];
    const payments = paymentsByOrder[plan.order_id] ?? [];
    const liveTotal = orderTotalsByOrder[plan.order_id] ?? plan.opening_total_amount;
    const computation = computePlanForOrder(plan, installments, payments, liveTotal, todayStr);

    if (computation.isStale) staleOrderIds.add(plan.order_id);
    if (computation.isInconsistent) inconsistentOrderIds.add(plan.order_id);

    for (const inst of computation.installments) {
      if (inst.status === "paid") continue;
      rows.push({
        orderId: plan.order_id,
        planId: plan.id,
        installmentNo: inst.installment_no,
        totalInstallments: installments.length,
        remainingAmount: inst.remainingAmount,
        dueDate: inst.due_date,
        status: inst.status,
        daysUntilDue: inst.daysUntilDue,
        isInconsistent: computation.isInconsistent,
      });
    }
  }

  return { rows, staleOrderIds, inconsistentOrderIds };
}
