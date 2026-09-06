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

export function daysBetween(fromStr: string, toStr: string): number {
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

// ============================================================================
// Odeme plani TASLAK olusturma — OrderDetail.tsx (mevcut siparise SONRADAN
// plan kurma) ve NewOrder.tsx/Quotes.tsx (siparis olusturulurken plan
// taslagi toplama) arasinda PAYLASILAN tek dogrulama mantigi. RPC cagirmaz,
// yalnizca formdaki taslagi create/rebuild_order_installment_plan'in kendi
// dogrulamasiyla ayni kurallarla (tutar>0, vade dolu, toplam=kalan) kontrol
// edip normalize eder.
// ============================================================================

export type InstallmentDraftRow = { amount: string; dueDate: string };
export type InstallmentPlanDraftInput = { installmentNo: number; amount: number; dueDate: string };

function formatTLForMessage(n: number): string {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(Number(n ?? 0));
}

export function buildInstallmentPlanFromDraft(
  mode: "single" | "multi",
  remainingAmount: number,
  singleDueDate: string,
  rows: InstallmentDraftRow[],
): { installments: InstallmentPlanDraftInput[] } | { error: string } {
  if (mode === "single") {
    const amount = Math.max(remainingAmount, 0);
    if (!singleDueDate) return { error: "Vade tarihi seçin." };
    if (amount <= 0) return { error: "Kalan borç 0 olduğu için plan oluşturulamaz." };
    return { installments: [{ installmentNo: 1, amount, dueDate: singleDueDate }] };
  }

  const parsed = rows.map((r, idx) => ({
    installmentNo: idx + 1,
    amount: Number(r.amount),
    dueDate: r.dueDate,
  }));
  if (parsed.some((r) => !Number.isFinite(r.amount) || r.amount <= 0)) {
    return { error: "Her taksidin tutarı 0'dan büyük olmalı." };
  }
  if (parsed.some((r) => !r.dueDate)) {
    return { error: "Her taksidin vade tarihi girilmeli." };
  }
  const sum = parsed.reduce((s, r) => s + r.amount, 0);
  if (Math.abs(sum - remainingAmount) > 0.01) {
    return { error: `Taksit toplamı (${formatTLForMessage(sum)}) kalan borca (${formatTLForMessage(remainingAmount)}) eşit olmalı.` };
  }
  return { installments: parsed };
}

// ============================================================================
// Tarih kovalama — Collections.tsx VE Dashboard.tsx'in AYNI tanimi kullanmasi
// icin burada tek yerde tutulur (birbirini tekrar etmeyen, birbirinden farkli
// kovalar): Geciken (vade<bugun) / Bugun (vade=bugun) / Bu Hafta (yarindan
// bulunulan haftanin pazarina kadar) / Bu Ay (bu haftadan sonra ay sonuna
// kadar) / Ileri Tarihli (ay sonrasi).
// ============================================================================

export type DateBucketKey = "overdue" | "today" | "week" | "month" | "future";
export type CollectionRowStatus = "overdue" | "today" | "upcoming" | "partial" | "undetermined";

function toDateOnlyStrLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Bulunulan haftanin (Pazartesi-Pazar) son gunu — Pazar. */
function endOfWeekSundayStr(todayStr: string): string {
  const d = new Date(`${todayStr}T00:00:00`);
  const day = d.getDay(); // 0=Pazar..6=Cumartesi
  const add = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + add);
  return toDateOnlyStrLocal(d);
}

/** Bulunulan ayin son gunu. */
function endOfMonthStr(todayStr: string): string {
  const d = new Date(`${todayStr}T00:00:00`);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return toDateOnlyStrLocal(end);
}

/** Tarih kovalari BIRBIRINI TEKRAR ETMEZ: her vade tam olarak bir kovaya duser. */
export function bucketForDueDate(dueDateStr: string, todayStr: string): DateBucketKey {
  if (dueDateStr < todayStr) return "overdue";
  if (dueDateStr === todayStr) return "today";
  const weekEnd = endOfWeekSundayStr(todayStr);
  if (dueDateStr <= weekEnd) return "week";
  const monthEnd = endOfMonthStr(todayStr);
  if (dueDateStr <= monthEnd) return "month";
  return "future";
}

/** Kismi odeme, zaman kovasindan ONCELIKLIDIR (Collections.tsx/Dashboard.tsx ortak kurali). */
export function collectionRowStatus(bucket: DateBucketKey | "undetermined", isPartial: boolean): CollectionRowStatus {
  if (bucket === "undetermined") return "undetermined";
  if (isPartial) return "partial";
  if (bucket === "overdue") return "overdue";
  if (bucket === "today") return "today";
  return "upcoming";
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
