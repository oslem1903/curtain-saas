import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet, Search, AlertTriangle, Clock, CalendarDays, CalendarRange, HelpCircle, CheckCircle2 } from "lucide-react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import {
  computePlanForOrder,
  daysBetween,
  todayDateOnly,
  bucketForDueDate,
  collectionRowStatus,
  type OrderPaymentPlan,
  type OrderInstallment,
  type LedgerPayment,
  type DateBucketKey,
  type CollectionRowStatus,
} from "../utils/installments";
import { EmptyState } from "../components/EmptyState";

// ============================================================================
// Tahsilatlar — Solo Perdeci icin Muhasebe'nin yerini tutan tahsilat ekrani.
//
// Tek dogruluk kaynagi: order_payment_plans (aktif) + order_installments +
// payments ledger'i, hepsi computePlanForOrder() ile (Dashboard/Accounting/
// OrderDetail'daki AYNI FIFO/net-tahsilat formulu) canli hesaplanir. Hicbir
// durum ayrica saklanmaz, yeni RPC/migration YOKTUR.
//
// Legacy orders.payment_due_date SADECE aktif plani OLMAYAN siparislerde
// kullanilir (plan varsa cift gosterim olmasin diye atlanir — aynen
// Dashboard.tsx/Accounting.tsx'teki mevcut kural).
// ============================================================================

type BucketKey = DateBucketKey | "undetermined";
type TabKey = BucketKey | "collected";

type RowStatus = CollectionRowStatus;

type OpenRow = {
  key: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  orderShort: string;
  label: string;
  dueDate: string | null;
  daysUntilDue: number | null;
  amount: number;
  collectedAmount: number;
  remainingAmount: number;
  status: RowStatus;
  bucket: BucketKey;
};

type CollectedRow = {
  key: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  orderShort: string;
  amount: number;
  date: string | null;
  method: string | null;
  note: string | null;
};

type OrderRow = {
  id: string;
  customer_id: string | null;
  total_amount: number | null;
  paid_amount: number | null;
  remaining_amount: number | null;
  payment_due_date: string | null;
  status: string | null;
  customer: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null;
};

function pickOne<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function fmtTL(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
}

function fmtDate(dateStr: string | null) {
  if (!dateStr) return "-";
  try { return new Date(`${dateStr}T12:00:00`).toLocaleDateString("tr-TR"); } catch { return dateStr; }
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleString("tr-TR"); } catch { return iso; }
}

const STATUS_META: Record<RowStatus, { label: string; className: string }> = {
  overdue: { label: "Gecikmiş", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  today: { label: "Bugün", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  upcoming: { label: "Yaklaşıyor", className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" },
  partial: { label: "Kısmi", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  undetermined: { label: "Vadesi Belirsiz", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
};

const TABS: { key: TabKey; label: string; icon: typeof AlertTriangle }[] = [
  { key: "overdue", label: "Geciken", icon: AlertTriangle },
  { key: "today", label: "Bugün", icon: Clock },
  { key: "week", label: "Bu Hafta", icon: CalendarDays },
  { key: "month", label: "Bu Ay", icon: CalendarRange },
  { key: "future", label: "İleri Tarihli", icon: CalendarRange },
  { key: "undetermined", label: "Vadesi Belirsiz", icon: HelpCircle },
  { key: "collected", label: "Tahsil Edilenler", icon: CheckCircle2 },
];

export default function Collections() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openRows, setOpenRows] = useState<OpenRow[]>([]);
  const [collectedRows, setCollectedRows] = useState<CollectedRow[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("overdue");
  const [search, setSearch] = useState("");

  useEffect(() => { void loadData(); }, []);

  async function loadData() {
    setLoading(true);
    setErr("");
    try {
      const ctx = await getEffectiveTenantContext();
      const todayStr = todayDateOnly();

      const [ordersRes, plansRes, paymentsRes] = await Promise.all([
        supabase
          .from("orders")
          .select("id,customer_id,total_amount,paid_amount,remaining_amount,payment_due_date,status,customer:customers(name,phone)")
          .eq("company_id", ctx.company_id),
        supabase
          .from("order_payment_plans")
          .select("id,order_id,opening_total_amount,opening_paid_amount,opening_remaining_amount,status")
          .eq("company_id", ctx.company_id)
          .eq("status", "active"),
        supabase
          .from("payments")
          .select("id,order_id,amount,method,note,payment_date,reverses_payment_id")
          .eq("company_id", ctx.company_id),
      ]);

      if (ordersRes.error) throw ordersRes.error;
      if (plansRes.error) throw plansRes.error;
      if (paymentsRes.error) throw paymentsRes.error;

      const orders = (ordersRes.data ?? []) as OrderRow[];
      const plans = (plansRes.data ?? []) as OrderPaymentPlan[];
      const allPayments = (paymentsRes.data ?? []) as (LedgerPayment & { id: string; order_id: string; payment_date: string | null; method: string | null; note: string | null })[];

      // Teklif/taslak/iptal siparisler aktif borc/tahsilat hesaplarina girmez
      // (Customers.tsx'teki ayni kural).
      const relevantOrders = orders.filter((o) => !["draft", "cancelled", "quoted"].includes(String(o.status ?? "").toLowerCase()));
      const ordersById = new Map(relevantOrders.map((o) => [o.id, o]));

      const planOrderIds: string[] = [];
      const openFromPlans: OpenRow[] = [];
      if (plans.length > 0) {
        const planIds = plans.map((p) => p.id);
        const installmentsRes = await supabase
          .from("order_installments")
          .select("id,plan_id,order_id,installment_no,amount,due_date")
          .in("plan_id", planIds);
        if (installmentsRes.error) throw installmentsRes.error;
        const installments = (installmentsRes.data ?? []) as OrderInstallment[];
        const installmentsByPlan = new Map<string, OrderInstallment[]>();
        installments.forEach((inst) => {
          const list = installmentsByPlan.get(inst.plan_id) ?? [];
          list.push(inst);
          installmentsByPlan.set(inst.plan_id, list);
        });

        const paymentsByOrder = new Map<string, LedgerPayment[]>();
        allPayments.forEach((p) => {
          const list = paymentsByOrder.get(p.order_id) ?? [];
          list.push(p);
          paymentsByOrder.set(p.order_id, list);
        });

        plans.forEach((plan) => {
          const order = ordersById.get(plan.order_id);
          if (!order) return; // teklif/iptal siparise bagli plan — atla
          planOrderIds.push(plan.order_id);

          const planInstallments = installmentsByPlan.get(plan.id) ?? [];
          const orderPayments = paymentsByOrder.get(plan.order_id) ?? [];
          const liveTotal = Number(order.total_amount ?? plan.opening_total_amount);
          const computation = computePlanForOrder(plan, planInstallments, orderPayments, liveTotal, todayStr);

          const customer = pickOne(order.customer);
          const customerName = customer?.name || "Müşteri";
          const customerPhone = customer?.phone || "";
          const orderShort = order.id.slice(0, 8).toUpperCase();
          const total = computation.installments.length;

          computation.installments.forEach((inst) => {
            if (inst.status === "paid") return; // tam odenmis taksit acik sekmede gorunmez
            const bucket = bucketForDueDate(inst.due_date, todayStr);
            const status = collectionRowStatus(bucket, inst.status === "partial");
            openFromPlans.push({
              key: `plan-${inst.id}`,
              orderId: order.id,
              customerName,
              customerPhone,
              orderShort,
              label: total === 1 ? "Tek Vade" : `${inst.installment_no}/${total} Taksit`,
              dueDate: inst.due_date,
              daysUntilDue: inst.daysUntilDue,
              amount: Number(inst.amount ?? 0),
              collectedAmount: inst.allocatedPaid,
              remainingAmount: inst.remainingAmount,
              status,
              bucket,
            });
          });
        });
      }

      const planOrderIdSet = new Set(planOrderIds);
      const openFromLegacyAndUndetermined: OpenRow[] = [];

      relevantOrders.forEach((order) => {
        if (planOrderIdSet.has(order.id)) return; // aktif plani var — legacy/undetermined ile TEKRAR gosterilmez
        const remaining = Number(order.remaining_amount ?? Math.max(Number(order.total_amount ?? 0) - Number(order.paid_amount ?? 0), 0));
        if (remaining <= 0.01) return; // tam odenmis — acik sekmede gorunmez

        const customer = pickOne(order.customer);
        const customerName = customer?.name || "Müşteri";
        const customerPhone = customer?.phone || "";
        const orderShort = order.id.slice(0, 8).toUpperCase();
        const isPartial = Number(order.paid_amount ?? 0) > 0.01;

        if (order.payment_due_date) {
          const dueDateStr = String(order.payment_due_date).slice(0, 10);
          const bucket = bucketForDueDate(dueDateStr, todayStr);
          openFromLegacyAndUndetermined.push({
            key: `legacy-${order.id}`,
            orderId: order.id,
            customerName,
            customerPhone,
            orderShort,
            label: "Vadeli Bakiye",
            dueDate: dueDateStr,
            daysUntilDue: daysBetween(todayStr, dueDateStr),
            amount: Number(order.total_amount ?? remaining),
            collectedAmount: Number(order.paid_amount ?? 0),
            remainingAmount: remaining,
            status: collectionRowStatus(bucket, isPartial),
            bucket,
          });
        } else {
          openFromLegacyAndUndetermined.push({
            key: `undetermined-${order.id}`,
            orderId: order.id,
            customerName,
            customerPhone,
            orderShort,
            label: "Vadesi Belirsiz Bakiye",
            dueDate: null,
            daysUntilDue: null,
            amount: Number(order.total_amount ?? remaining),
            collectedAmount: Number(order.paid_amount ?? 0),
            remainingAmount: remaining,
            status: "undetermined",
            bucket: "undetermined",
          });
        }
      });

      setOpenRows([...openFromPlans, ...openFromLegacyAndUndetermined]);

      // Tahsil Edilenler — YALNIZCA net (iptal edilmemis) orijinal tahsilatlar.
      // Bir odeme sonradan customer_cancel_collection ile ters kayitla iptal
      // edildiyse (baska bir payments satiri onu reverses_payment_id ile
      // isaret eder), NE orijinal NE de ters kayit burada gosterilir —
      // ikisinin net etkisi zaten sifirdir (computeLiveNetPaid ile AYNI kural).
      const reversedIds = new Set(allPayments.map((p) => p.reverses_payment_id).filter((x): x is string => Boolean(x)));
      const netCollected = allPayments
        .filter((p) => !p.reverses_payment_id && !reversedIds.has(p.id))
        .map((p): CollectedRow | null => {
          const order = ordersById.get(p.order_id);
          if (!order) return null;
          const customer = pickOne(order.customer);
          return {
            key: `payment-${p.id}`,
            orderId: order.id,
            customerName: customer?.name || "Müşteri",
            customerPhone: customer?.phone || "",
            orderShort: order.id.slice(0, 8).toUpperCase(),
            amount: Number(p.amount ?? 0),
            date: p.payment_date,
            method: p.method,
            note: p.note,
          };
        })
        .filter((r): r is CollectedRow => r !== null)
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

      setCollectedRows(netCollected);
    } catch (e: any) {
      setErr(e?.message ?? "Tahsilatlar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }

  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (name: string, phone: string, orderShort: string) => {
    if (!searchLower) return true;
    return (
      name.toLowerCase().includes(searchLower) ||
      phone.toLowerCase().includes(searchLower) ||
      orderShort.toLowerCase().includes(searchLower)
    );
  };

  const rowsByBucket = useMemo(() => {
    const map: Record<BucketKey, OpenRow[]> = { overdue: [], today: [], week: [], month: [], future: [], undetermined: [] };
    openRows.forEach((r) => { map[r.bucket].push(r); });
    return map;
  }, [openRows]);

  const totals = useMemo(() => {
    const sum = (rows: OpenRow[]) => rows.reduce((s, r) => s + r.remainingAmount, 0);
    return {
      overdue: { count: rowsByBucket.overdue.length, amount: sum(rowsByBucket.overdue) },
      today: { count: rowsByBucket.today.length, amount: sum(rowsByBucket.today) },
      week: { count: rowsByBucket.week.length, amount: sum(rowsByBucket.week) },
      month: { count: rowsByBucket.month.length, amount: sum(rowsByBucket.month) },
      future: { count: rowsByBucket.future.length, amount: sum(rowsByBucket.future) },
      undetermined: { count: rowsByBucket.undetermined.length, amount: sum(rowsByBucket.undetermined) },
      totalOpen: openRows.reduce((s, r) => s + r.remainingAmount, 0),
      collected: { count: collectedRows.length, amount: collectedRows.reduce((s, r) => s + r.amount, 0) },
    };
  }, [rowsByBucket, openRows, collectedRows]);

  const activeOpenRows = activeTab === "collected" ? [] : rowsByBucket[activeTab].filter((r) => matchesSearch(r.customerName, r.customerPhone, r.orderShort));
  const activeCollectedRows = activeTab === "collected" ? collectedRows.filter((r) => matchesSearch(r.customerName, r.customerPhone, r.orderShort)) : [];

  if (loading) return <div className="p-10 text-center font-bold">Yükleniyor...</div>;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 dark:text-white">
          <Wallet className="h-6 w-6 text-primary-600" />
          Tahsilatlar
        </h1>
        <p className="mt-0.5 text-xs text-slate-400">Gecikmiş, bugünkü ve yaklaşan tahsilatlarınızı tek ekrandan takip edin.</p>
      </div>

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{err}</div> : null}

      {/* Ozet kartlari */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="rounded-2xl border border-red-100 bg-red-50/60 p-4 dark:border-red-900/30 dark:bg-red-900/10">
          <div className="text-[10px] font-black uppercase text-red-500">Geciken</div>
          <div className="mt-1 text-lg font-black text-red-700 dark:text-red-300">{fmtTL(totals.overdue.amount)}</div>
          <div className="text-[10px] font-bold text-red-400">{totals.overdue.count} kayıt</div>
        </div>
        <div className="rounded-2xl border border-orange-100 bg-orange-50/60 p-4 dark:border-orange-900/30 dark:bg-orange-900/10">
          <div className="text-[10px] font-black uppercase text-orange-500">Bugün</div>
          <div className="mt-1 text-lg font-black text-orange-700 dark:text-orange-300">{fmtTL(totals.today.amount)}</div>
          <div className="text-[10px] font-bold text-orange-400">{totals.today.count} kayıt</div>
        </div>
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 dark:border-indigo-900/30 dark:bg-indigo-900/10">
          <div className="text-[10px] font-black uppercase text-indigo-500">Bu Hafta</div>
          <div className="mt-1 text-lg font-black text-indigo-700 dark:text-indigo-300">{fmtTL(totals.week.amount)}</div>
          <div className="text-[10px] font-bold text-indigo-400">{totals.week.count} kayıt</div>
        </div>
        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900/30 dark:bg-blue-900/10">
          <div className="text-[10px] font-black uppercase text-blue-500">Bu Ay</div>
          <div className="mt-1 text-lg font-black text-blue-700 dark:text-blue-300">{fmtTL(totals.month.amount)}</div>
          <div className="text-[10px] font-bold text-blue-400">{totals.month.count} kayıt</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40 col-span-2 sm:col-span-1">
          <div className="text-[10px] font-black uppercase text-slate-500">Toplam Açık Alacak</div>
          <div className="mt-1 text-lg font-black text-slate-800 dark:text-slate-100">{fmtTL(totals.totalOpen)}</div>
          <div className="text-[10px] font-bold text-slate-400">{openRows.length} kayıt</div>
        </div>
      </div>

      {/* Arama */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Müşteri adı, telefon veya sipariş no ara..."
          className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-900"
        />
      </div>

      {/* Sekmeler */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((tab) => {
          const isCollected = tab.key === "collected";
          const meta = isCollected ? totals.collected : totals[tab.key as BucketKey];
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex shrink-0 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition ${
                activeTab === tab.key
                  ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
                  : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs font-black text-slate-700 dark:text-slate-200">
                <Icon className="h-3.5 w-3.5" /> {tab.label}
              </span>
              <span className="text-[10px] font-bold text-slate-400">
                {meta.count} kayıt · {fmtTL(meta.amount)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Liste */}
      {activeTab !== "collected" ? (
        activeOpenRows.length === 0 ? (
          <EmptyState icon={Wallet} title="Bu sekmede kayıt yok" description="Bu kategoride görüntülenecek açık tahsilat bulunmuyor." />
        ) : (
          <div className="space-y-2">
            {activeOpenRows.map((row) => {
              const meta = STATUS_META[row.status];
              return (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => nav(`/orders/${row.orderId}`)}
                  className="block w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/40"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-slate-900 dark:text-white">{row.customerName}</span>
                        {row.customerPhone ? <span className="text-xs text-slate-400">{row.customerPhone}</span> : null}
                        <span className="text-xs font-bold text-blue-600">#{row.orderShort}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>{row.label}</span>
                        <span>•</span>
                        <span>Vade: {fmtDate(row.dueDate)}</span>
                        {row.daysUntilDue != null ? (
                          <>
                            <span>•</span>
                            <span>{row.daysUntilDue < 0 ? `${-row.daysUntilDue} gün gecikti` : row.daysUntilDue === 0 ? "bugün" : `${row.daysUntilDue} gün kaldı`}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 sm:text-right">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400">Taksit Tutarı</div>
                        <div className="font-black text-slate-800 dark:text-slate-100">{fmtTL(row.amount)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400">Kalan</div>
                        <div className="font-black text-rose-600">{fmtTL(row.remainingAmount)}</div>
                      </div>
                      <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${meta.className}`}>{meta.label}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : activeCollectedRows.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Henüz tahsilat yok" description="Bu aramaya uyan tahsil edilmiş bir ödeme bulunmuyor." />
      ) : (
        <div className="space-y-2">
          {activeCollectedRows.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => nav(`/orders/${row.orderId}`)}
              className="block w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/40"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-slate-900 dark:text-white">{row.customerName}</span>
                    {row.customerPhone ? <span className="text-xs text-slate-400">{row.customerPhone}</span> : null}
                    <span className="text-xs font-bold text-blue-600">#{row.orderShort}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{row.method || "Ödeme"}</span>
                    <span>•</span>
                    <span>{row.note || "Açıklama yok"}</span>
                    <span>•</span>
                    <span>{fmtDateTime(row.date)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4 sm:text-right">
                  <div className="font-black text-emerald-700 dark:text-emerald-400">{fmtTL(row.amount)}</div>
                  <span className="rounded-lg bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Ödendi</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
