import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet, Search, AlertTriangle, Clock, CalendarDays, CalendarRange, HelpCircle, CheckCircle2, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { getEffectiveTenantContext, supabase, isAppReadOnly } from "../supabaseClient";
import { allocateFifo, type DebtItem } from "../utils/payables";
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
import { useAuth } from "../context/AuthContext";

// ============================================================================
// Tahsilat ve Ödemeler — Solo Perdeci icin Muhasebe'nin yerini tutan tahsilat ekrani.
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
type TabKey = BucketKey | "all";

type RowStatus = CollectionRowStatus;

type RowKind = "customer" | "supplier" | "installer";
type KindFilter = "all" | RowKind | "collected";

type OpenRow = {
  kind: RowKind;
  partyId?: string;
  editTable?: "orders" | "supplier_transactions";
  editId?: string;
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
  undetermined: { label: "Vadesiz", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
};

const TABS: { key: TabKey; label: string; icon: typeof AlertTriangle }[] = [
  { key: "all", label: "Tümü", icon: Wallet },
  { key: "overdue", label: "Geciken", icon: AlertTriangle },
  { key: "today", label: "Bugün", icon: Clock },
  { key: "week", label: "Bu Hafta", icon: CalendarDays },
  { key: "month", label: "Bu Ay", icon: CalendarRange },
  { key: "future", label: "İleri Tarihli", icon: CalendarRange },
  { key: "undetermined", label: "Vadesiz", icon: HelpCircle },
];

const KIND_TABS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "Tümü" },
  { key: "customer", label: "Müşteri Alacakları" },
  { key: "supplier", label: "Tedarikçi Borçları" },
  { key: "installer", label: "Montajcı Borçları" },
  { key: "collected", label: "Tahsil Edilenler" },
];

export default function Collections() {
  const nav = useNavigate();
  const { readOnly: authReadOnly } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openRows, setOpenRows] = useState<OpenRow[]>([]);
  const [collectedRows, setCollectedRows] = useState<CollectedRow[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [dueEdit, setDueEdit] = useState<{ key: string; value: string } | null>(null);
  const [dueMsg, setDueMsg] = useState("");
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
              kind: "customer",
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
            kind: "customer",
            editTable: "orders",
            editId: order.id,
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
            kind: "customer",
            editTable: "orders",
            editId: order.id,
            key: `undetermined-${order.id}`,
            orderId: order.id,
            customerName,
            customerPhone,
            orderShort,
            label: "Vadesiz Bakiye",
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

      const payableRows: OpenRow[] = [];
      // --- Tedarikçi borçları (supplier_transactions: borç − ödeme/iptal/alacak + ödeme iadesi), FIFO ---
      try {
        const supRes = await supabase
          .from("supplier_transactions")
          .select("id,supplier_id,transaction_type,amount,transaction_date,due_date,description,suppliers(name)")
          .eq("company_id", ctx.company_id);
        if (!supRes.error) {
          type SupEntry = { name: string; debts: (DebtItem & { due: string | null; desc: string })[]; netPaid: number };
          const bySupplier = new Map<string, SupEntry>();
          (supRes.data ?? []).forEach((r: any) => {
            const sid = String(r.supplier_id ?? "");
            if (!sid) return;
            const entry: SupEntry = bySupplier.get(sid) ?? { name: (pickOne(r.suppliers) as { name?: string } | null)?.name || "Tedarikçi", debts: [], netPaid: 0 };
            const amt = Number(r.amount ?? 0);
            if (r.transaction_type === "debt") {
              const due = r.due_date ? String(r.due_date).slice(0, 10) : null;
              entry.debts.push({ key: String(r.id), amount: amt, sortDate: due ?? (r.transaction_date ? String(r.transaction_date).slice(0, 10) : null), due, desc: r.description || "" });
            } else if (["payment", "cancel", "credit"].includes(r.transaction_type)) entry.netPaid += amt;
            else if (r.transaction_type === "payment_reversal") entry.netPaid -= amt;
            bySupplier.set(sid, entry);
          });
          bySupplier.forEach((entry, sid) => {
            const { open } = allocateFifo(entry.debts, Math.max(entry.netPaid, 0));
            open.forEach((d) => {
              const src = entry.debts.find((x) => x.key === d.key)!;
              const bucket = src.due ? bucketForDueDate(src.due, todayStr) : "undetermined";
              payableRows.push({
                kind: "supplier", partyId: sid, editTable: "supplier_transactions", editId: d.key,
                key: `sup-${d.key}`, orderId: "", customerName: entry.name, customerPhone: "", orderShort: "",
                label: src.desc || "Tedarikçi borcu", dueDate: src.due,
                daysUntilDue: src.due ? daysBetween(todayStr, src.due) : null,
                amount: d.amount, collectedAmount: d.paid, remainingAmount: d.remaining,
                status: src.due ? collectionRowStatus(bucket as DateBucketKey, d.paid > 0.01) : "undetermined",
                bucket,
              });
            });
          });
        }
      } catch { /* tedarikçi modülü/tablo yok */ }

      // --- Montajcı borçları: tamamlanan iş hakedişleri + manuel hakedişler − ödemeler (InstallerLedger ile aynı kural) ---
      try {
        const [empRes, jobRes, earnRes, txRes] = await Promise.all([
          supabase.from("employees").select("id,user_id,full_name").eq("company_id", ctx.company_id),
          supabase.from("installation_jobs").select("id,order_id,assigned_staff_id,status,installer_fee,is_internal_installation").eq("company_id", ctx.company_id).eq("status", "completed"),
          supabase.from("installer_earnings").select("id,installer_id,installation_job_id,order_id,earning_type,total_earning,created_at").eq("company_id", ctx.company_id),
          supabase.from("installer_transactions").select("installer_id,transaction_type,amount").eq("company_id", ctx.company_id),
        ]);
        if (!jobRes.error && !empRes.error) {
          const keyOf = new Map<string, string>();
          const nameOf = new Map<string, string>();
          (empRes.data ?? []).forEach((e: any) => {
            const k = String(e.user_id || e.id);
            [e.id, e.user_id].filter(Boolean).forEach((i: string) => keyOf.set(i, k));
            if (!nameOf.has(k)) nameOf.set(k, e.full_name || "Montajcı");
          });
          const earnings = (earnRes.error ? [] : (earnRes.data ?? [])) as any[];
          const byInstaller = new Map<string, { debts: (DebtItem & { orderId: string; desc: string })[]; netPaid: number }>();
          const get = (k: string) => { const v = byInstaller.get(k) ?? { debts: [], netPaid: 0 }; byInstaller.set(k, v); return v; };
          (jobRes.data ?? []).forEach((j: any) => {
            if (j.is_internal_installation || !j.assigned_staff_id) return; // Kendim yapıyorum: montajcı borcu yok
            const k = keyOf.get(j.assigned_staff_id) ?? String(j.assigned_staff_id);
            const earn = earnings.find((e) => e.installation_job_id === j.id);
            const amt = earn ? Number(earn.total_earning ?? 0) : Number(j.installer_fee ?? 0);
            if (amt > 0) get(k).debts.push({ key: `job-${j.id}`, amount: amt, sortDate: null, orderId: j.order_id || "", desc: "Montaj hakedişi" });
          });
          earnings.filter((e) => e.earning_type === "manual" && !e.installation_job_id).forEach((e) => {
            const k = keyOf.get(e.installer_id) ?? String(e.installer_id);
            get(k).debts.push({ key: `earn-${e.id}`, amount: Number(e.total_earning ?? 0), sortDate: e.created_at ? String(e.created_at).slice(0, 10) : null, orderId: e.order_id || "", desc: "Manuel hakediş" });
          });
          (txRes.error ? [] : (txRes.data ?? [])).forEach((t: any) => {
            if (t.transaction_type === "earning") return;
            const k = keyOf.get(t.installer_id) ?? String(t.installer_id);
            get(k).netPaid += t.transaction_type === "payment" ? Number(t.amount ?? 0) : -Number(t.amount ?? 0);
          });
          byInstaller.forEach((v, k) => {
            const { open } = allocateFifo(v.debts, Math.max(v.netPaid, 0));
            open.forEach((d) => {
              const src = v.debts.find((x) => x.key === d.key)!;
              payableRows.push({
                kind: "installer", partyId: k,
                key: `inst-${d.key}`, orderId: src.orderId, customerName: nameOf.get(k) || "Montajcı", customerPhone: "",
                orderShort: src.orderId ? src.orderId.slice(0, 8).toUpperCase() : "",
                label: src.desc, dueDate: null, daysUntilDue: null,
                amount: d.amount, collectedAmount: d.paid, remainingAmount: d.remaining,
                status: "undetermined", bucket: "undetermined",
              });
            });
          });
        }
      } catch { /* montajcı cari yok */ }

      setOpenRows([...openFromPlans, ...openFromLegacyAndUndetermined, ...payableRows]);

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

  const kindRows = useMemo(
    () => (kindFilter === "all" ? openRows : kindFilter === "collected" ? [] : openRows.filter((r) => r.kind === kindFilter)),
    [openRows, kindFilter],
  );

  const rowsByBucket = useMemo(() => {
    const map: Record<BucketKey, OpenRow[]> = { overdue: [], today: [], week: [], month: [], future: [], undetermined: [] };
    kindRows.forEach((r) => { map[r.bucket].push(r); });
    return map;
  }, [kindRows]);

  // Üst kartlar: HER ZAMAN tüm açık kayıtlar (filtreden bağımsız)
  const summary = useMemo(() => {
    const sum = (k: RowKind) => openRows.filter((r) => r.kind === k).reduce((s, r) => s + r.remainingAmount, 0);
    const receivable = sum("customer"), supplier = sum("supplier"), installer = sum("installer");
    return { receivable, supplier, installer, net: Math.round((receivable - supplier - installer) * 100) / 100 };
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
      totalOpen: kindRows.reduce((s, r) => s + r.remainingAmount, 0),
      collected: { count: collectedRows.length, amount: collectedRows.reduce((s, r) => s + r.amount, 0) },
    };
  }, [rowsByBucket, kindRows, collectedRows]);

  const showCollected = kindFilter === "collected";
  const activeOpenRows = showCollected ? [] : (activeTab === "all" ? kindRows : rowsByBucket[activeTab]).filter((r) => matchesSearch(r.customerName, r.customerPhone, r.orderShort));
  const activeCollectedRows = showCollected ? collectedRows.filter((r) => matchesSearch(r.customerName, r.customerPhone, r.orderShort)) : [];

  async function saveDueDate(row: OpenRow, value: string) {
    if (!row.editTable || !row.editId || !value) return;
    setDueMsg("");
    // Yalnız vade tarihi alanı güncellenir; tutarlara dokunulmaz.
    const patch = row.editTable === "orders" ? { payment_due_date: value } : { due_date: value };
    const { error } = await supabase.from(row.editTable).update(patch).eq("id", row.editId);
    if (error) { setDueMsg(`Vade kaydedilemedi: ${error.message}`); return; }
    setDueEdit(null);
    await loadData();
  }

  if (loading) return <div className="p-10 text-center font-bold">Yükleniyor...</div>;

  // Salt okunur: süresi dolmuş lisans / salt okunur firma / demo — yazma düğmeleri gizlenir (sunucu da engeller)
  const readOnly = authReadOnly || isAppReadOnly();
  const canRecord = !readOnly;

  const openLinks = (row: OpenRow) => {
    if (row.kind === "customer") return { pay: `/orders/${row.orderId}`, detail: `/orders/${row.orderId}`, payLabel: "Tahsilat Ekle" };
    if (row.kind === "supplier") return { pay: `/suppliers/${row.partyId}`, detail: `/suppliers/${row.partyId}`, payLabel: "Ödeme Ekle" };
    return { pay: "/installations?tab=cari", detail: `/installer/${row.partyId}/earnings`, payLabel: "Ödeme Ekle" };
  };
  const KIND_LABEL: Record<RowKind, string> = { customer: "Müşteri alacağı", supplier: "Tedarikçi borcu", installer: "Montajcı borcu" };

  return (
    <div className="mx-auto min-w-0 max-w-5xl p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 dark:text-white">
          <Wallet className="h-6 w-6 text-primary-600" />
          Tahsilat ve Ödemeler
        </h1>
        <p className="mt-0.5 text-xs text-slate-400">Müşterilerden alacaklarınızı, tedarikçi ve montajcılara ödemelerinizi tek ekrandan takip edin.</p>
      </div>

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{err}</div> : null}
      {dueMsg ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">{dueMsg}</div> : null}

      {/* Özet kartları */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 dark:border-emerald-900/30 dark:bg-emerald-900/10">
          <div className="flex items-center gap-1 text-[10px] font-black uppercase text-emerald-600"><ArrowDownLeft className="h-3 w-3" /> Müşterilerden alınacak toplam</div>
          <div className="mt-1 break-words text-lg font-black text-emerald-700 dark:text-emerald-300">{fmtTL(summary.receivable)}</div>
        </div>
        <div className="min-w-0 rounded-2xl border border-rose-100 bg-rose-50/60 p-4 dark:border-rose-900/30 dark:bg-rose-900/10">
          <div className="flex items-center gap-1 text-[10px] font-black uppercase text-rose-600"><ArrowUpRight className="h-3 w-3" /> Tedarikçilere ödenecek toplam</div>
          <div className="mt-1 break-words text-lg font-black text-rose-700 dark:text-rose-300">{fmtTL(summary.supplier)}</div>
        </div>
        <div className="min-w-0 rounded-2xl border border-rose-100 bg-rose-50/60 p-4 dark:border-rose-900/30 dark:bg-rose-900/10">
          <div className="flex items-center gap-1 text-[10px] font-black uppercase text-rose-600"><ArrowUpRight className="h-3 w-3" /> Montajcılara ödenecek toplam</div>
          <div className="mt-1 break-words text-lg font-black text-rose-700 dark:text-rose-300">{fmtTL(summary.installer)}</div>
        </div>
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
          <div className="text-[10px] font-black uppercase text-slate-500">Net alacak/borç farkı</div>
          <div className={`mt-1 break-words text-lg font-black ${summary.net >= 0 ? "text-slate-800 dark:text-slate-100" : "text-rose-700 dark:text-rose-300"}`}>{fmtTL(summary.net)}</div>
          <div className="text-[10px] font-bold text-slate-400">Alacak − (tedarikçi + montajcı borcu). Kâr veya kasa bakiyesi değildir.</div>
        </div>
      </div>

      {/* Arama */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Kişi/firma adı, telefon veya sipariş no ara..."
          className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-900"
        />
      </div>

      {/* Tür filtresi */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {KIND_TABS.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setKindFilter(k.key)}
            className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-black transition ${
              kindFilter === k.key ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {/* Tarih filtresi */}
      {!showCollected ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {TABS.map((tab) => {
            const meta = tab.key === "all" ? { count: kindRows.length, amount: totals.totalOpen } : totals[tab.key as BucketKey];
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
      ) : null}

      {/* Liste */}
      {!showCollected ? (
        activeOpenRows.length === 0 ? (
          <EmptyState icon={Wallet} title="Bu filtrede kayıt yok" description="Bu kategoride görüntülenecek açık alacak veya borç bulunmuyor." />
        ) : (
          <div className="space-y-2">
            {activeOpenRows.map((row) => {
              const meta = STATUS_META[row.status];
              const links = openLinks(row);
              const isReceivable = row.kind === "customer";
              const Arrow = isReceivable ? ArrowDownLeft : ArrowUpRight;
              const canEditDue = canRecord && !row.dueDate && Boolean(row.editTable && row.editId);
              return (
                <div
                  key={row.key}
                  className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black ${isReceivable ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"}`}>
                          <Arrow className="h-3 w-3" /> {KIND_LABEL[row.kind]}
                        </span>
                        <span className="break-words font-black text-slate-900 dark:text-white">{row.customerName}</span>
                        {row.customerPhone ? <span className="text-xs text-slate-400">{row.customerPhone}</span> : null}
                        {row.orderShort ? <span className="text-xs font-bold text-blue-600">#{row.orderShort}</span> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>{row.label}</span>
                        <span>•</span>
                        <span>Vade: {row.dueDate ? fmtDate(row.dueDate) : "Vadesiz"}</span>
                        {row.daysUntilDue != null ? (
                          <>
                            <span>•</span>
                            <span>{row.daysUntilDue < 0 ? `${-row.daysUntilDue} gün gecikti` : row.daysUntilDue === 0 ? "bugün" : `${row.daysUntilDue} gün kaldı`}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 sm:justify-end sm:text-right">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400">Toplam</div>
                        <div className="font-black text-slate-800 dark:text-slate-100">{fmtTL(row.amount)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400">Kalan</div>
                        <div className={`font-black ${isReceivable ? "text-emerald-700" : "text-rose-600"}`}>{fmtTL(row.remainingAmount)}</div>
                      </div>
                      <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${meta.className}`}>{meta.label}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {canRecord ? (
                      <button
                        type="button"
                        onClick={() => nav(links.pay)}
                        className={`rounded-xl px-3 py-2 text-xs font-black text-white ${isReceivable ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}`}
                      >
                        {links.payLabel}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => nav(links.detail)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      Detay / Ekstre
                    </button>
                    {canEditDue ? (
                      dueEdit?.key === row.key ? (
                        <span className="flex items-center gap-2">
                          <input
                            type="date"
                            value={dueEdit.value}
                            onChange={(e) => setDueEdit({ key: row.key, value: e.target.value })}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                          />
                          <button type="button" disabled={!dueEdit.value} onClick={() => void saveDueDate(row, dueEdit.value)} className="rounded-lg bg-primary-600 px-2 py-1 text-xs font-black text-white disabled:opacity-50">Kaydet</button>
                          <button type="button" onClick={() => setDueEdit(null)} className="text-xs font-bold text-slate-500">Vazgeç</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setDueEdit({ key: row.key, value: "" })} className="text-xs font-black text-primary-600 hover:underline">Vade tarihi ekle</button>
                      )
                    ) : null}
                  </div>
                </div>
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
              className="block w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/40"
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
