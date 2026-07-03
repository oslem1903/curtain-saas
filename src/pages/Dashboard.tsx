import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  CreditCard,
  Hammer,
  PackageCheck,
  ReceiptText,
  Ruler,
  ShoppingCart,
  Truck,
  Users,
} from "lucide-react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { useRole } from "../context/RoleContext";
import { cn } from "../utils/cn";

type AppointmentRow = {
  id: string;
  title: string | null;
  type: string | null;
  status: string | null;
  done?: boolean | null;
  start_at: string | null;
  scheduled_at: string | null;
  address?: string | null;
  customer?: { name: string | null; phone?: string | null } | Array<{ name: string | null; phone?: string | null }> | null;
};

type InstallationJobRow = {
  id: string;
  order_id: string;
  customer_name: string | null;
  status: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  total_amount: number | null;
};

type DueRow = {
  id: string;
  name: string;
  amount: number;
  due: string;
  target: string;
};

type SupplierDueRow = {
  name: string;
  amount: number;
  due: string;
};

type RecentOrder = {
  id: string;
  created_at: string | null;
  status: string | null;
  customer_name: string;
  total: number;
};

type WorkItem = {
  id: string;
  title: string;
  subtitle: string;
  when: Date;
  target: string;
  kind: "measurement" | "installation" | "collection" | "supplier";
};

type DashboardData = {
  todayMeasurements: AppointmentRow[];
  todayInstallations: Array<AppointmentRow | InstallationJobRow>;
  todayCollections: DueRow[];
  overdueCollections: DueRow[];
  weekCollections: DueRow[];
  supplierDue: SupplierDueRow[];
  supplierOverdue: SupplierDueRow[];
  upcoming: WorkItem[];
  recentOrders: RecentOrder[];
  totalCustomers: number;
  activeOrders: number;
  completedInstallations: number;
  monthSales: number;
  monthCost: number;
};

const emptyData: DashboardData = {
  todayMeasurements: [],
  todayInstallations: [],
  todayCollections: [],
  overdueCollections: [],
  weekCollections: [],
  supplierDue: [],
  supplierOverdue: [],
  upcoming: [],
  recentOrders: [],
  totalCustomers: 0,
  activeOrders: 0,
  completedInstallations: 0,
  monthSales: 0,
  monthCost: 0,
};

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function money(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function isoOf(row: { start_at?: string | null; scheduled_at?: string | null }) {
  return row.start_at || row.scheduled_at || null;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isClosed(status?: string | null, done?: boolean | null) {
  const s = String(status || "").toLowerCase();
  return done === true || ["done", "completed", "delivered", "cancelled", "canceled", "paid"].includes(s);
}

function isMeasurement(row: AppointmentRow) {
  const raw = `${row.type || ""} ${row.title || ""}`.toLocaleLowerCase("tr-TR");
  return raw.includes("measurement") || raw.includes("ölç") || raw.includes("olc");
}

function isInstallation(row: AppointmentRow) {
  const raw = `${row.type || ""} ${row.title || ""}`.toLocaleLowerCase("tr-TR");
  return raw.includes("installation") || raw.includes("montaj");
}

function customerName(row: AppointmentRow) {
  return pickOne(row.customer)?.name || "Müşteri";
}

function relativeTime(target: Date) {
  const diff = target.getTime() - Date.now();
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  if (diff < 0) {
    if (min < 60) return `${min || 1} dk gecikti`;
    if (hours < 24) return `${hours} saat gecikti`;
    return `${days} gün gecikti`;
  }
  if (min < 60) return `${min || 1} dk kaldı`;
  if (hours < 24) return `${hours} saat kaldı`;
  if (days === 1) return "Yarın";
  return `${days} gün sonra`;
}

function toneForDate(date: Date) {
  const diff = date.getTime() - Date.now();
  if (diff < 0) return "red";
  if (diff <= 24 * 60 * 60 * 1000) return "amber";
  return "blue";
}

function orderProgress(status?: string | null) {
  const s = String(status || "").toLowerCase();
  if (["delivered", "done", "completed", "paid", "teslim_edildi"].includes(s)) return { pct: 100, label: "Teslim Edildi" };
  if (["installation_ready", "montaja_hazir", "ready"].includes(s)) return { pct: 75, label: "Montaja Hazır" };
  if (["production", "in_production", "uretimde", "confirmed", "active"].includes(s)) return { pct: 50, label: "Üretimde" };
  return { pct: 25, label: "Ölçü Alındı" };
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-slate-200/80 dark:bg-slate-800", className)} />;
}

const SummaryCard = memo(function SummaryCard({
  loading,
  data,
}: {
  loading: boolean;
  data: DashboardData;
}) {
  const first = data.upcoming[0];
  // eslint-disable-next-line react-hooks/purity -- görüntü tonu için anlık zaman; saf-render dışı, davranış aynı
  const nowMs = Date.now();
  const overdueCount = data.upcoming.filter((item) => item.when.getTime() < nowMs).length + data.overdueCollections.length + data.supplierOverdue.length;
  const tone = overdueCount > 0 ? "red" : first && first.when.getTime() - nowMs <= 60 * 60 * 1000 ? "amber" : "blue";
  const classes = {
    blue: "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-100",
    amber: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100",
    red: "border-red-200 bg-red-50 text-red-950 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-100",
  }[tone];

  if (loading) return <Skeleton className="h-32" />;

  return (
    <section className={cn("rounded-3xl border p-5 shadow-sm sm:p-6", classes)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest opacity-70">
            <Clock3 className="h-4 w-4" />
            Günün Özeti
          </div>
          <h2 className="text-xl font-black leading-tight sm:text-2xl">
            Bugün {data.todayMeasurements.length} ölçü, {data.todayInstallations.length} montaj ve {money(data.todayCollections.reduce((s, r) => s + r.amount, 0))} tahsilatınız bulunuyor.
          </h2>
          <p className="mt-3 text-sm font-semibold opacity-80">
            {overdueCount > 0
              ? `${overdueCount} geciken iş var. Önce bunları kapatmanız önerilir.`
              : first
                ? `${first.when.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} saatindeki ${first.subtitle} işine ${relativeTime(first.when)}.`
                : "Bugün için yaklaşan kritik iş görünmüyor."}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[320px]">
          <div className="rounded-2xl bg-white/60 p-3 dark:bg-white/10">
            <div className="text-2xl font-black">{data.todayMeasurements.length}</div>
            <div className="text-[11px] font-bold opacity-70">Ölçü</div>
          </div>
          <div className="rounded-2xl bg-white/60 p-3 dark:bg-white/10">
            <div className="text-2xl font-black">{data.todayInstallations.length}</div>
            <div className="text-[11px] font-bold opacity-70">Montaj</div>
          </div>
          <div className="rounded-2xl bg-white/60 p-3 dark:bg-white/10">
            <div className="text-2xl font-black">{data.overdueCollections.length + data.supplierOverdue.length}</div>
            <div className="text-[11px] font-bold opacity-70">Geciken</div>
          </div>
        </div>
      </div>
    </section>
  );
});

const MetricCard = memo(function MetricCard({
  title,
  value,
  note,
  icon: Icon,
  tone,
  onClick,
}: {
  title: string;
  value: string;
  note: string;
  icon: any;
  tone: "blue" | "emerald" | "amber" | "violet";
  onClick: () => void;
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/20 dark:text-blue-200 dark:border-blue-900/40",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-200 dark:border-emerald-900/40",
    amber: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/20 dark:text-amber-200 dark:border-amber-900/40",
    violet: "bg-violet-50 text-violet-700 border-violet-100 dark:bg-violet-950/20 dark:text-violet-200 dark:border-violet-900/40",
  }[tone];

  return (
    <button type="button" onClick={onClick} className="group min-w-0 rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-widest text-slate-400">{title}</div>
          <div className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{value}</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">{note}</div>
        </div>
        <span className={cn("rounded-2xl border p-3 transition group-hover:scale-105", tones)}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </button>
  );
});

const ActionButton = memo(function ActionButton({ label, icon: Icon, onClick }: { label: string; icon: any; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-20 items-center gap-3 rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-primary-200 hover:bg-primary-50/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-primary-950/20">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-lg shadow-primary-600/20">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 text-sm font-black text-slate-900 dark:text-white">{label}</span>
    </button>
  );
});

export const Dashboard = () => {
  const navigate = useNavigate();
  const { effectiveRole: role, realRole, viewingUserId } = useRole();
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const previousRoleRef = useRef<{ role: string; realRole: string; viewingUserId: string | null }>({ role: "unknown", realRole: "unknown", viewingUserId: null });

  const go = useCallback((path: string, state?: object) => {
    navigate(path, state ? { state } : undefined);
  }, [navigate]);

  const loadDashboard = useCallback(async (opts?: { silent?: boolean }) => {
    if (role === "unknown") return;
    // silent: focus/görünürlük tazelemesinde skeleton gösterme (flicker olmasın); veriler
    // güncellenince kartlar yerinde değişir. Hesaplama/toplam mantığı aynıdır.
    if (!opts?.silent) setLoading(true);
    setError("");

    try {
      const ctx = await getEffectiveTenantContext();
      const todayStart = startOfToday();
      const todayEnd = endOfToday();
      const todayStr = dateOnly(todayStart);
      const weekEnd = dateOnly(addDays(todayStart, 7));
      const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
      const monthEnd = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 0, 23, 59, 59, 999);
      const workerId = (realRole === "super_admin" && viewingUserId) ? viewingUserId : ctx.user.id;
      const scopedAppointments = role === "installer" || role === "measurement";

      let appointmentQuery = supabase
        .from("appointments")
        .select("id,title,type,status,done,start_at,scheduled_at,address,assigned_to,customer:customers(name,phone)")
        .eq("company_id", ctx.company_id)
        .gte("start_at", todayStart.toISOString())
        .lte("start_at", addDays(todayStart, 7).toISOString());
      if (scopedAppointments) appointmentQuery = appointmentQuery.eq("assigned_to", workerId);

      const [
        appointmentsRes,
        jobsRes,
        ordersRes,
        dueOrdersRes,
        suppliersRes,
        customersRes,
        incomeRes,
        completedJobsRes,
        monthOrdersRes,
      ] = await Promise.allSettled([
        appointmentQuery.order("start_at", { ascending: true }),
        supabase.from("installation_jobs").select("id,order_id,customer_name,status,scheduled_date,scheduled_time,total_amount").eq("company_id", ctx.company_id).gte("scheduled_date", todayStr).lte("scheduled_date", weekEnd).order("scheduled_date", { ascending: true }),
        supabase.from("orders").select("id,created_at,status,total_amount,paid_amount,remaining_amount,customer:customers(name)").eq("company_id", ctx.company_id).order("created_at", { ascending: false }).limit(8),
        supabase.from("orders").select("id,remaining_amount,total_amount,paid_amount,payment_due_date,customer:customers(name)").eq("company_id", ctx.company_id).not("payment_due_date", "is", null),
        supabase.from("supplier_transactions").select("supplier_id,amount,due_date,transaction_type,suppliers(name)").eq("company_id", ctx.company_id),
        supabase.from("customers").select("id", { count: "exact", head: true }).eq("company_id", ctx.company_id),
        supabase.from("income").select("amount,income_date").eq("company_id", ctx.company_id).gte("income_date", todayStart.toISOString()).lte("income_date", todayEnd.toISOString()),
        supabase.from("installation_jobs").select("id", { count: "exact", head: true }).eq("company_id", ctx.company_id).eq("status", "completed"),
        supabase.from("orders").select("id,total_amount,created_at").eq("company_id", ctx.company_id).neq("status", "cancelled").gte("created_at", monthStart.toISOString()).lte("created_at", monthEnd.toISOString()),
      ]);

      const appointments = appointmentsRes.status === "fulfilled" && !appointmentsRes.value.error ? (appointmentsRes.value.data ?? []) as AppointmentRow[] : [];
      const jobs = jobsRes.status === "fulfilled" && !jobsRes.value.error ? (jobsRes.value.data ?? []) as InstallationJobRow[] : [];
      const orderRows = ordersRes.status === "fulfilled" && !ordersRes.value.error ? (ordersRes.value.data ?? []) as any[] : [];
      const dueOrders = dueOrdersRes.status === "fulfilled" && !dueOrdersRes.value.error ? (dueOrdersRes.value.data ?? []) as any[] : [];
      const supplierRows = suppliersRes.status === "fulfilled" && !suppliersRes.value.error ? (suppliersRes.value.data ?? []) as any[] : [];
      const monthOrders = monthOrdersRes.status === "fulfilled" && !monthOrdersRes.value.error ? (monthOrdersRes.value.data ?? []) as any[] : [];
      const monthOrderIds = monthOrders.map((order) => order.id).filter(Boolean);

      let monthCost = 0;
      if (monthOrderIds.length > 0) {
        const itemsRes = await supabase.from("order_items").select("order_id,supplier_total_cost,supplier_unit_cost,qty,profit,line_total").in("order_id", monthOrderIds);
        if (!itemsRes.error) {
          monthCost = (itemsRes.data ?? []).reduce((sum: number, item: any) => {
            const explicit = Number(item.supplier_total_cost ?? 0);
            const calculated = Number(item.supplier_unit_cost ?? 0) * Number(item.qty ?? 1);
            return sum + (explicit || calculated || 0);
          }, 0);
        }
      }

      const todayMeasurements = appointments.filter((a) => {
        const iso = isoOf(a);
        if (!iso) return false;
        const time = new Date(iso).getTime();
        return time >= todayStart.getTime() && time <= todayEnd.getTime() && isMeasurement(a) && !isClosed(a.status, a.done);
      });

      const todayInstallAppts = appointments.filter((a) => {
        const iso = isoOf(a);
        if (!iso) return false;
        const time = new Date(iso).getTime();
        return time >= todayStart.getTime() && time <= todayEnd.getTime() && isInstallation(a) && !isClosed(a.status, a.done);
      });

      const todayJobs = jobs.filter((job) => job.scheduled_date === todayStr && !isClosed(job.status));
      const customerDue: DueRow[] = dueOrders
        .map((order) => {
          const paid = Number(order.paid_amount ?? 0);
          const total = Number(order.total_amount ?? 0);
          const remaining = Number(order.remaining_amount ?? Math.max(total - paid, 0));
          const customer = pickOne(order.customer);
          return {
            id: order.id,
            name: customer?.name || "Müşteri",
            amount: remaining,
            due: order.payment_due_date,
            target: "/accounting",
          };
        })
        .filter((row) => row.amount > 0.01 && row.due);

      // Tedarikçi başına NET bakiye (borç - ödeme - iptal) hesapla. Vadeli açık borcu
      // brüt değil KALAN tutarla göster — ödenmiş/kısmen ödenmiş vadeli borç kartı şişirmesin.
      const supplierAgg = new Map<string, { name: string; balance: number; earliestDue: string | null }>();
      for (const row of supplierRows) {
        const sid = row.supplier_id;
        if (!sid) continue;
        const entry = supplierAgg.get(sid) ?? { name: pickOne(row.suppliers)?.name || "Tedarikçi", balance: 0, earliestDue: null };
        const amt = Number(row.amount ?? 0);
        if (row.transaction_type === "debt") entry.balance += amt;
        else if (row.transaction_type === "payment" || row.transaction_type === "cancel") entry.balance -= amt;
        // Vade yalnızca borç satırında anlamlı — en erken (en acil) vadeyi tut.
        if (row.transaction_type === "debt" && row.due_date) {
          if (!entry.earliestDue || row.due_date < entry.earliestDue) entry.earliestDue = row.due_date;
        }
        supplierAgg.set(sid, entry);
      }

      const supplierDueRows: SupplierDueRow[] = Array.from(supplierAgg.values())
        .filter((e) => e.earliestDue && e.balance > 0.01)
        .map((e) => ({ name: e.name, amount: e.balance, due: e.earliestDue as string }));

      const upcoming: WorkItem[] = [
        ...appointments
          .filter((a) => !isClosed(a.status, a.done) && isoOf(a))
          .map((a) => ({
            id: a.id,
            title: isInstallation(a) ? "Montaj" : "Ölçü",
            subtitle: customerName(a),
            when: new Date(isoOf(a)!),
            target: `/appointments/${a.id}`,
            kind: isInstallation(a) ? "installation" as const : "measurement" as const,
          })),
        ...jobs
          .filter((job) => job.scheduled_date && !isClosed(job.status))
          .map((job) => ({
            id: job.id,
            title: "Montaj",
            subtitle: job.customer_name || "Müşteri",
            when: new Date(`${job.scheduled_date}T${job.scheduled_time || "09:00"}`),
            target: "/route/today",
            kind: "installation" as const,
          })),
        ...customerDue
          .filter((row) => row.due <= weekEnd)
          .map((row) => ({
            id: `collection-${row.id}`,
            title: "Tahsilat",
            subtitle: `${row.name} - ${money(row.amount)}`,
            when: new Date(`${row.due}T12:00:00`),
            target: "/accounting",
            kind: "collection" as const,
          })),
        ...supplierDueRows
          .filter((row) => row.due <= weekEnd)
          .map((row, index) => ({
            id: `supplier-${index}-${row.due}`,
            title: "Tedarikçi Ödemesi",
            subtitle: `${row.name} - ${money(row.amount)}`,
            when: new Date(`${row.due}T12:00:00`),
            target: "/suppliers",
            kind: "supplier" as const,
          })),
      ].sort((a, b) => a.when.getTime() - b.when.getTime());

      const recentOrders = orderRows.map((order) => ({
        id: order.id,
        created_at: order.created_at,
        status: order.status,
        customer_name: pickOne(order.customer)?.name || "Müşteri",
        total: Number(order.total_amount ?? 0),
      }));

      const incomeToday = incomeRes.status === "fulfilled" && !incomeRes.value.error
        ? (incomeRes.value.data ?? []).reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0)
        : 0;
      const todayCollections = customerDue.filter((row) => row.due === todayStr);
      if (incomeToday > 0 && todayCollections.length === 0) {
        todayCollections.push({ id: "income-today", name: "Bugünkü tahsilat", amount: incomeToday, due: todayStr, target: "/accounting" });
      }

      setData({
        todayMeasurements,
        todayInstallations: [...todayInstallAppts, ...todayJobs],
        todayCollections,
        overdueCollections: customerDue.filter((row) => row.due < todayStr),
        weekCollections: customerDue.filter((row) => row.due > todayStr && row.due <= weekEnd),
        supplierDue: supplierDueRows.filter((row) => row.due >= todayStr && row.due <= weekEnd),
        supplierOverdue: supplierDueRows.filter((row) => row.due < todayStr),
        upcoming,
        recentOrders,
        totalCustomers: customersRes.status === "fulfilled" && !customersRes.value.error ? customersRes.value.count ?? 0 : 0,
        activeOrders: orderRows.filter((order) => !isClosed(order.status)).length,
        completedInstallations: completedJobsRes.status === "fulfilled" && !completedJobsRes.value.error ? completedJobsRes.value.count ?? 0 : 0,
        monthSales: monthOrders.reduce((sum, order) => sum + Number(order.total_amount ?? 0), 0),
        monthCost,
      });
    } catch (e: any) {
      setError(e?.message || "Panel verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [role, realRole, viewingUserId]);

  useEffect(() => {
    // Only reload if actual role values changed (not just reference changes)
    const prevRole = previousRoleRef.current;
    const roleChanged = prevRole.role !== role || prevRole.realRole !== realRole || prevRole.viewingUserId !== viewingUserId;

    if (roleChanged) {
      previousRoleRef.current = { role, realRole, viewingUserId };
      void loadDashboard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız rol değişiminde yükle (previousRoleRef guard'lı)
  }, [role, realRole, viewingUserId]);

  // Pencere/sekme yeniden odaklandığında paneli SESSİZ tazele: başka ekranda/tabda yapılan
  // işlem (sipariş/tahsilat/iptal vb.) sonrası kartlar bayat kalmasın. Skeleton göstermez
  // (silent), debounce'lu (3sn) — gereksiz istek yapmaz. Hesaplama/toplam mantığı değişmez.
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - last < 3000) return;
      last = now;
      void loadDashboard({ silent: true });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadDashboard]);

  const monthProfit = data.monthSales - data.monthCost;
  const supplierDueTotal = useMemo(() => [...data.supplierDue, ...data.supplierOverdue].reduce((sum, row) => sum + row.amount, 0), [data.supplierDue, data.supplierOverdue]);
  const collectionTotal = useMemo(() => data.todayCollections.reduce((sum, row) => sum + row.amount, 0), [data.todayCollections]);

  if (role === "unknown") {
    return <div className="p-4 text-sm font-bold text-slate-500">Panel hazırlanıyor...</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 overflow-x-clip">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white sm:text-3xl">
            {role === "accountant" ? "Muhasebe Paneli" : role === "installer" ? "Saha Paneli" : "Yönetici Paneli"}
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">Bugünkü işleri, tahsilatları ve kârlılığı tek ekrandan yönetin.</p>
        </div>
        <button type="button" onClick={() => void loadDashboard()} className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
          Yenile
        </button>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div> : null}

      <SummaryCard loading={loading} data={data} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />) : (
          <>
            <MetricCard title="Ölçüler" value={String(data.todayMeasurements.length)} note="Bugünkü ölçü adedi" icon={Ruler} tone="blue" onClick={() => go("/appointments/new")} />
            <MetricCard title="Montajlar" value={String(data.todayInstallations.length)} note="Bugünkü montaj adedi" icon={Hammer} tone="emerald" onClick={() => go("/route/today")} />
            <MetricCard title="Tahsilatlar" value={money(collectionTotal)} note={`${data.todayCollections.length} müşteri bekliyor`} icon={CreditCard} tone="amber" onClick={() => go("/accounting")} />
            <MetricCard title="Tedarikçi Ödemeleri" value={money(supplierDueTotal)} note={`${data.supplierOverdue.length} geciken, ${data.supplierDue.length} vadesi gelen`} icon={Truck} tone="violet" onClick={() => go("/suppliers")} />
          </>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Hızlı İşlemler</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <ActionButton label="Yeni Ölçü" icon={Ruler} onClick={() => go("/measurements/new")} />
          <ActionButton label="Yeni Sipariş" icon={ShoppingCart} onClick={() => go("/orders/new")} />
          <ActionButton label="Tahsilat Yap" icon={Banknote} onClick={() => go("/accounting")} />
          <ActionButton label="Ödeme Yap" icon={ReceiptText} onClick={() => go("/suppliers")} />
          <ActionButton label="Randevu Oluştur" icon={CalendarPlus} onClick={() => go("/appointments/new")} />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Yaklaşan İşler</h2>
            <span className="text-xs font-bold text-slate-400">{data.upcoming.length} kayıt</span>
          </div>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : data.upcoming.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-6 text-sm font-bold text-slate-500 dark:bg-slate-800/50">Yaklaşan iş yok.</div>
          ) : (
            <div className="space-y-3">
              {data.upcoming.slice(0, 8).map((item) => {
                const tone = toneForDate(item.when);
                return (
                  <button key={item.id} type="button" onClick={() => go(item.target)} className={cn("w-full rounded-2xl border p-4 text-left transition hover:shadow-md", tone === "red" && "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20", tone === "amber" && "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20", tone === "blue" && "border-blue-100 bg-blue-50/50 dark:border-blue-900/40 dark:bg-blue-950/10")}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-black text-slate-950 dark:text-white">{item.title}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{item.subtitle}</div>
                      </div>
                      <div className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-black", tone === "red" && "bg-red-600 text-white", tone === "amber" && "bg-amber-500 text-white", tone === "blue" && "bg-blue-600 text-white")}>
                        {relativeTime(item.when)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Bu Ay Kârınız</h2>
          {loading ? <Skeleton className="mt-4 h-48" /> : (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/50">
                <span className="text-sm font-bold text-slate-500">Toplam Satış</span>
                <span className="font-black text-slate-950 dark:text-white">{money(data.monthSales)}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/50">
                <span className="text-sm font-bold text-slate-500">Toplam Maliyet</span>
                <span className="font-black text-slate-950 dark:text-white">{money(data.monthCost)}</span>
              </div>
              <div className={cn("flex items-center justify-between rounded-2xl p-4", monthProfit >= 0 ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200" : "bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-200")}>
                <span className="text-sm font-black">Net Kâr</span>
                <span className="text-2xl font-black">{money(monthProfit)}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.55fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Son Siparişler</h2>
            <button type="button" onClick={() => go("/orders")} className="text-xs font-black text-primary-600">Tümünü Gör</button>
          </div>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          ) : (
            <div className="space-y-3">
              {data.recentOrders.map((order) => {
                const progress = orderProgress(order.status);
                return (
                  <button key={order.id} type="button" onClick={() => go(`/orders/${order.id}`)} className="w-full rounded-2xl border border-slate-100 p-4 text-left transition hover:border-primary-200 hover:bg-primary-50/40 dark:border-slate-800 dark:hover:bg-primary-950/10">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-black text-slate-950 dark:text-white">#{order.id.slice(0, 8).toUpperCase()} - {order.customer_name}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">{money(order.total)}</div>
                      </div>
                      <div className="w-full sm:w-48">
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className="h-full rounded-full bg-primary-600" style={{ width: `${progress.pct}%` }} />
                        </div>
                        <div className="mt-1 text-right text-xs font-black text-slate-500">{progress.label} (%{progress.pct})</div>
                      </div>
                    </div>
                  </button>
                );
              })}
              {data.recentOrders.length === 0 ? <div className="rounded-2xl bg-slate-50 p-6 text-sm font-bold text-slate-500 dark:bg-slate-800/50">Henüz sipariş yok.</div> : null}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
          <h2 className="text-lg font-black text-slate-950 dark:text-white">İşletme Nabzı</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => go("/customers")} className="rounded-2xl bg-slate-50 p-4 text-left dark:bg-slate-800/50">
              <Users className="mb-2 h-5 w-5 text-blue-600" />
              <div className="text-xl font-black">{data.totalCustomers}</div>
              <div className="text-xs font-bold text-slate-500">Müşteri</div>
            </button>
            <button type="button" onClick={() => go("/orders")} className="rounded-2xl bg-slate-50 p-4 text-left dark:bg-slate-800/50">
              <PackageCheck className="mb-2 h-5 w-5 text-emerald-600" />
              <div className="text-xl font-black">{data.activeOrders}</div>
              <div className="text-xs font-bold text-slate-500">Aktif Sipariş</div>
            </button>
            <button type="button" onClick={() => go("/route/today")} className="rounded-2xl bg-slate-50 p-4 text-left dark:bg-slate-800/50">
              <CheckCircle2 className="mb-2 h-5 w-5 text-violet-600" />
              <div className="text-xl font-black">{data.completedInstallations}</div>
              <div className="text-xs font-bold text-slate-500">Biten Montaj</div>
            </button>
            <button type="button" onClick={() => go("/accounting")} className="rounded-2xl bg-slate-50 p-4 text-left dark:bg-slate-800/50">
              <AlertTriangle className="mb-2 h-5 w-5 text-red-600" />
              <div className="text-xl font-black">{data.overdueCollections.length + data.supplierOverdue.length}</div>
              <div className="text-xs font-bold text-slate-500">Geciken</div>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
