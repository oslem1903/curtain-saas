import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { TrendingUp, Users, CreditCard, ClipboardList, CheckCircle2, Calendar } from "lucide-react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { useRole } from "../context/RoleContext";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

async function getContext() {
    return getEffectiveTenantContext();
}

type CalendarAppt = {
    id: string;
    title: string | null;
    address: string | null;
    start_at: string | null;
    scheduled_at: string | null;
    type: string | null;
    status: string | null;
    done?: boolean | null;
    customer?: { name: string | null } | { name: string | null }[] | null;
    assigned_to?: string | null;
};

type TodayAppt = {
    id: string;
    type: string | null;
    title: string | null;
    address: string | null;
    start_at: string | null;
    scheduled_at: string | null;
    status: string | null;
    assigned_to?: string | null;
    customer?: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null;
};

type Upcoming = {
    id: string;
    title: string | null;
    address: string | null;
    start_at: string | null;
    scheduled_at: string | null;
    type: string | null;
    status?: string | null;
    customer?: { name: string | null } | { name: string | null }[] | null;
};

type RecentOrderRow = {
    id: string;
    created_at: string;
    status: string | null;
    customer_name: string;
    total: number;
};

function pickOne<T>(v: T | T[] | null | undefined): T | null {
    if (!v) return null;
    return Array.isArray(v) ? v[0] ?? null : v;
}

function apptIso(a: { start_at?: string | null; scheduled_at?: string | null }) {
    return a.start_at ?? a.scheduled_at ?? null;
}

function safeIso(u: { start_at: string | null; scheduled_at: string | null }) {
    return u.start_at ?? u.scheduled_at ?? null;
}

function getTimeKey(u: { start_at: string | null; scheduled_at: string | null }) {
    const iso = safeIso(u);
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? t : 0;
}

function isDoneOrCancelled(s?: string | null) {
    const v = (s ?? "").toLowerCase();
    return v === "done" || v === "cancelled" || v === "canceled";
}

function isOverdue(a: {
    start_at?: string | null;
    scheduled_at?: string | null;
    status?: string | null;
    done?: boolean | null;
}) {
    const iso = apptIso(a);
    if (!iso) return false;
    if (a.done === true) return false;
    if (a.status && ["done", "cancelled", "canceled"].includes(a.status.toLowerCase())) {
        return false;
    }
    return new Date(iso).getTime() < Date.now();
}

function isDueSoon(a: {
    start_at?: string | null;
    scheduled_at?: string | null;
    status?: string | null;
    done?: boolean | null;
}) {
    const iso = apptIso(a);
    if (!iso) return false;
    if (a.done === true) return false;
    if (a.status && ["done", "cancelled", "canceled"].includes(a.status.toLowerCase())) {
        return false;
    }

    const t = new Date(iso).getTime();
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    return t >= now && t <= now + oneDay;
}

function dayKeyTR(iso: string) {
    return new Date(iso).toLocaleDateString("tr-TR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        weekday: "long",
    });
}

function timeTR(iso: string) {
    return new Date(iso).toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatTime(iso?: string | null) {
    if (!iso) return "--:--";
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

function formatDateTR(iso?: string | null) {
    if (!iso) return "-";
    try {
        return new Date(iso).toLocaleDateString("tr-TR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        });
    } catch {
        return iso;
    }
}

function formatTL(n: number) {
    return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        maximumFractionDigits: 2,
    }).format(Number.isFinite(n) ? n : 0);
}

function typeTR(t?: string | null) {
    return (t ?? "").toLowerCase() === "installation" ? "Montaj" : "Ölçü";
}

function statusLabel(s?: string | null) {
    const v = (s ?? "").toLowerCase();
    if (v === "paid") return "Ödendi";
    if (v === "partial") return "Kısmi";
    if (v === "cancelled" || v === "canceled") return "İptal";
    return "İşleniyor";
}

function statusBadgeClass(s?: string | null) {
    const v = (s ?? "").toLowerCase();
    if (v === "paid") {
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    }
    if (v === "partial") {
        return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
    }
    if (v === "cancelled" || v === "canceled") {
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    }
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
}

const StatCard = ({
    title,
    value,
    change,
    icon: Icon,
    trend,
    colorClass = "from-primary-500 to-primary-600",
    onClick
}: {
    title: string;
    value: string;
    change: string;
    icon: any;
    trend: "up" | "down";
    colorClass?: string;
    onClick?: () => void;
}) => (
    <div 
        onClick={onClick}
        className={cn(
            "group relative overflow-hidden bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-xl transition-all duration-500 hover:-translate-y-1",
            onClick && "cursor-pointer active:scale-95"
        )}
    >
        <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${colorClass} opacity-[0.03] -mr-8 -mt-8 rounded-full blur-2xl group-hover:opacity-10 transition-opacity`}></div>
        
        <div className="flex items-start justify-between relative z-10">
            <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</p>
                <h3 className="text-2xl font-black mt-2 text-slate-900 dark:text-slate-100">{value}</h3>
            </div>
            <div className={`p-4 bg-gradient-to-br ${colorClass} rounded-2xl text-white shadow-lg shadow-primary-500/20 transform group-hover:rotate-12 transition-transform duration-500`}>
                <Icon className="w-5 h-5" />
            </div>
        </div>

        <div className="mt-6 flex items-center gap-2 relative z-10">
            <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${trend === "up"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    }`}
            >
                {change}
            </span>
            <span className="text-[10px] text-slate-400 font-medium italic">geçen aya göre döküm</span>
        </div>
    </div>
);


export const Dashboard = () => {
    const location = useLocation();
    const nav = useNavigate();

    const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
    const [, setUpcomingLoading] = useState(false);

    const [recentOrders, setRecentOrders] = useState<RecentOrderRow[]>([]);
    const [, setRecentLoading] = useState(false);

    const [todayAppts, setTodayAppts] = useState<TodayAppt[]>([]);
    const [todayLoading, setTodayLoading] = useState(false);
    const [todayErr, setTodayErr] = useState("");

    const [calendarDays, setCalendarDays] = useState<{ day: string; items: CalendarAppt[] }[]>([]);
    const [overdue, setOverdue] = useState<CalendarAppt[]>([]);
    const [, setCalLoading] = useState(false);
    const [, setCalErr] = useState("");

    const [refreshKey, setRefreshKey] = useState(0);
    const refreshAll = () => setRefreshKey((k) => k + 1);
    const { effectiveRole: role, realRole, viewingUserId } = useRole();
    const [stats, setStats] = useState({
        totalRevenue: 0,
        activeOrders: 0,
        pendingPayments: 0,
        draftQuotes: 0,
        todayAppointments: 0,
        totalCustomers: 0,
        completedWorks: 0,
        waitingPricingCount: 0, 
        convertedCount: 0       
    });
    const [overdueCount, setOverdueCount] = useState(0);
    const [staffMap, setStaffMap] = useState<Record<string, { full_name: string; role: string }>>({});



    useEffect(() => {
        if ((location.state as any)?.refresh) {
            refreshAll();
        }
    }, [location.state]);

    useEffect(() => {
        let channel: ReturnType<typeof supabase.channel> | null = null;
        let active = true;

        async function subscribeAppointments() {
            try {
                const ctx = await getContext();
                if (!active) return;
                channel = supabase
                    .channel(`dashboard-appointments-${ctx.company_id}`)
                    .on(
                        "postgres_changes",
                        {
                            event: "*",
                            schema: "public",
                            table: "appointments",
                            filter: `company_id=eq.${ctx.company_id}`,
                        },
                        () => refreshAll(),
                    )
                    .subscribe();
            } catch (e) {
                console.error("appointments realtime error:", e);
            }
        }

        function handleFocus() {
            refreshAll();
        }

        subscribeAppointments();
        window.addEventListener("focus", handleFocus);
        document.addEventListener("visibilitychange", handleFocus);

        return () => {
            active = false;
            window.removeEventListener("focus", handleFocus);
            document.removeEventListener("visibilitychange", handleFocus);
            if (channel) supabase.removeChannel(channel);
        };
    }, []);

    useEffect(() => {
        let alive = true;
        if (role === "unknown") return;

        async function loadStaff() {
            try {
                const ctx = await getContext();
                const { data: members } = await supabase
                    .from("company_members")
                    .select("user_id")
                    .eq("company_id", ctx.company_id);

                const ids = (members ?? []).map((m) => m.user_id).filter(Boolean);
                if (ids.length > 0) {
                    const { data: profiles } = await supabase
                        .from("profiles")
                        .select("user_id, full_name, role")
                        .in("user_id", ids);

                    const map: Record<string, { full_name: string; role: string }> = {};
                    (profiles ?? []).forEach((p) => {
                        map[p.user_id] = {
                            full_name: p.full_name || "İsimsiz",
                            role: p.role || "installer",
                        };
                    });
                    setStaffMap(map);
                }
            } catch (e) {
                console.error("Staff load error:", e);
            }
        }

        async function loadToday() {
            setTodayLoading(true);
            setTodayErr("");

            try {
                const ctx = await getContext();
                const start = new Date();
                start.setHours(0, 0, 0, 0);
                const end = new Date();
                end.setHours(23, 59, 59, 999);
                const startIso = start.toISOString();
                const endIso = end.toISOString();

                let query = supabase
                    .from("appointments")
                    .select(`
                        id,
                        title,
                        address,
                        start_at,
                        scheduled_at,
                        type,
                        status,
                        assigned_to,
                        customer:customers(name, phone)
                    `)
                    .eq("company_id", ctx.company_id)
                    .gte("start_at", startIso)
                    .lte("start_at", endIso)
                    .in("status", ["planned", "postponed"]);

                if (role === "installer" || role === "measurement") {
                    const targetId = (realRole === "super_admin" && viewingUserId) ? viewingUserId : ctx.user.id;
                    query = query.eq("assigned_to", targetId);
                }

                const { data, error } = await query.order("start_at", { ascending: true });
                if (!alive) return;
                if (error) throw error;

                const rows = ((data ?? []) as TodayAppt[])
                    .filter((a) => !isDoneOrCancelled(a.status));

                setTodayAppts(rows);
            } catch (e: any) {
                if (!alive) return;
                setTodayErr(e?.message ?? "Bugünün randevuları yüklenemedi");
                setTodayAppts([]);
            } finally {
                if (alive) setTodayLoading(false);
            }
        }

        loadStaff();
        loadToday();

        return () => {
            alive = false;
        };
    }, [refreshKey, role, realRole, viewingUserId]);

    useEffect(() => {
        let alive = true;
        if (role === "unknown") return;

        async function loadCalendar() {
            setCalLoading(true);
            setCalErr("");

            try {
                const ctx = await getContext();
                const from = new Date();
                from.setDate(from.getDate() - 7);
                from.setHours(0, 0, 0, 0);
                const to = new Date();
                to.setDate(to.getDate() + 4);
                to.setHours(23, 59, 59, 999);
                const fromIso = from.toISOString();
                const toIso = to.toISOString();

                let query = supabase
                    .from("appointments")
                    .select(`
                        id,
                        title,
                        address,
                        start_at,
                        scheduled_at,
                        type,
                        status,
                        done,
                        assigned_to,
                        customer:customers(name)
                    `)
                    .eq("company_id", ctx.company_id)
                    .or(
                        `and(start_at.gte.${fromIso},start_at.lte.${toIso}),and(scheduled_at.gte.${fromIso},scheduled_at.lte.${toIso})`
                    );

                if (role === "installer" || role === "measurement") {
                    const targetId = (realRole === "super_admin" && viewingUserId) ? viewingUserId : ctx.user.id;
                    query = query.eq("assigned_to", targetId);
                }

                const { data, error } = await query;
                if (error) throw error;
                if (!alive) return;

                const rows = ((data ?? []) as CalendarAppt[])
                    .filter((a) => !isDoneOrCancelled(a.status))
                    .slice();

                rows.sort((a, b) => {
                    const ia = apptIso(a) ?? "";
                    const ib = apptIso(b) ?? "";
                    return new Date(ia).getTime() - new Date(ib).getTime();
                });

                const overdueList = rows.filter((a) => isOverdue(a));
                const map = new Map<string, CalendarAppt[]>();
                for (const a of rows) {
                    const iso = apptIso(a);
                    if (!iso) continue;
                    const key = dayKeyTR(iso);
                    const arr = map.get(key) ?? [];
                    arr.push(a);
                    map.set(key, arr);
                }

                const grouped = Array.from(map.entries()).map(([day, items]) => ({
                    day,
                    items: items.sort((x, y) => getTimeKey(x) - getTimeKey(y)),
                }));

                grouped.sort((a, b) => {
                    const firstA = apptIso(a.items[0]) ?? "";
                    const firstB = apptIso(b.items[0]) ?? "";
                    return new Date(firstA).getTime() - new Date(firstB).getTime();
                });

                setOverdue(overdueList);
                setCalendarDays(grouped);
                setOverdueCount(overdueList.length);
            } catch (e: any) {
                if (!alive) return;
                setCalErr(e?.message ?? "Takvim yüklenemedi");
                setOverdue([]);
                setCalendarDays([]);
            } finally {
                if (alive) setCalLoading(false);
            }
        }

        loadCalendar();

        return () => {
            alive = false;
        };
    }, [refreshKey, role, realRole, viewingUserId]);

    useEffect(() => {
        let alive = true;
        if (role === "unknown") return;

        async function loadUpcoming() {
            setUpcomingLoading(true);
            try {
                const ctx = await getContext();
                const nowIso = new Date().toISOString();
                let query = supabase
                    .from("appointments")
                    .select(`
                        id,
                        title,
                        address,
                        start_at,
                        scheduled_at,
                        type,
                        status,
                        assigned_to,
                        customer:customers(name)
                    `)
                    .eq("company_id", ctx.company_id)
                    .in("type", ["measurement", "installation"])
                    .in("status", ["planned", "postponed"])
                    .or(`start_at.gte.${nowIso},scheduled_at.gte.${nowIso}`);

                if (role === "installer" || role === "measurement") {
                    const targetId = (realRole === "super_admin" && viewingUserId) ? viewingUserId : ctx.user.id;
                    query = query.eq("assigned_to", targetId);
                }

                const { data, error } = await query
                    .order("start_at", { ascending: true, nullsFirst: false })
                    .order("scheduled_at", { ascending: true, nullsFirst: false })
                    .limit(20);

                if (!alive) return;
                if (error) throw error;
                setUpcoming(data ?? []);
            } finally {
                if (alive) setUpcomingLoading(false);
            }
        }

        async function loadRecentOrders() {
            setRecentLoading(true);
            try {
                const ctx = await getContext();
                const ordersQuery = supabase
                    .from("orders")
                    .select(`
                        id,
                        created_at,
                        status,
                        total_amount,
                        remaining_amount,
                        assigned_to,
                        created_by,
                        customer:customers(name)
                    `)
                    .eq("company_id", ctx.company_id)
                    .order("created_at", { ascending: false })
                    .limit(5);

                const { data, error } = await ordersQuery;
                if (!alive) return;
                if (error) throw error;

                const targetId = (realRole === "super_admin" && viewingUserId) ? viewingUserId : ctx.user.id;
                const scoped = (role === "installer" || role === "measurement")
                    ? (data ?? []).filter((o: any) => o.assigned_to === targetId || o.created_by === targetId)
                    : (data ?? []);

                const mapped: RecentOrderRow[] = scoped.map((o: any) => ({
                    id: o.id,
                    created_at: o.created_at,
                    status: o.status ?? null,
                    customer_name: pickOne(o.customer)?.name ?? "-",
                    total: Number(o.total_amount ?? 0),
                }));
                setRecentOrders(mapped);
            } finally {
                if (alive) setRecentLoading(false);
            }
        }

        async function loadStats() {
            try {
                const ctx = await getContext();
                const { data: ordsRaw } = await supabase
                    .from("orders")
                    .select("status, total_amount, remaining_amount, customer_id, assigned_to, created_by")
                    .eq("company_id", ctx.company_id);

                const targetId = (realRole === "super_admin" && viewingUserId) ? viewingUserId : ctx.user.id;
                const ords = (role === "installer" || role === "measurement")
                    ? (ordsRaw ?? []).filter((o: any) => o.assigned_to === targetId || o.created_by === targetId)
                    : (ordsRaw ?? []);

                let totalRevenue = 0;
                let activeOrders = 0;
                let pendingPayments = 0;
                let draftQuotes = 0;

                (ords ?? []).forEach((o) => {
                    if (o.status !== "cancelled") totalRevenue += Number(o.total_amount || 0);
                    if (o.status === "open" || o.status === "partial") activeOrders++;
                    if (o.status === "draft") draftQuotes++;
                    pendingPayments += Number(o.remaining_amount || 0);
                });

                const scopedCustomerIds = new Set<string>();
                (ords ?? []).forEach((o: any) => {
                    if (o.customer_id) scopedCustomerIds.add(o.customer_id);
                });

                const { count: customerCount } = (role === "installer" || role === "measurement")
                    ? { count: scopedCustomerIds.size }
                    : await supabase
                        .from("customers")
                        .select("*", { count: "exact", head: true })
                        .eq("company_id", ctx.company_id);

                let doneQuery = supabase
                    .from("appointments")
                    .select("*", { count: "exact", head: true })
                    .eq("company_id", ctx.company_id)
                    .eq("status", "done");
                if (role === "installer" || role === "measurement") doneQuery = doneQuery.eq("assigned_to", targetId);
                const { count: doneCount } = await doneQuery;

                let measuredQuery = supabase
                    .from("appointments")
                    .select("*", { count: "exact", head: true })
                    .eq("company_id", ctx.company_id)
                    .eq("status", "measured");
                if (role === "installer" || role === "measurement") measuredQuery = measuredQuery.eq("assigned_to", targetId);
                const { count: measuredCount } = await measuredQuery;

                if (!alive) return;
                setStats({
                    totalRevenue,
                    activeOrders,
                    pendingPayments,
                    draftQuotes,
                    totalCustomers: customerCount || 0,
                    completedWorks: doneCount || 0,
                    waitingPricingCount: measuredCount || 0,
                    todayAppointments: 0, 
                    convertedCount: 0
                });
            } catch (e) {
                console.error("Stats error:", e);
            }
        }

        loadUpcoming();
        loadRecentOrders();
        loadStats();

        return () => {
            alive = false;
        };
    }, [refreshKey, role, realRole, viewingUserId]);

    if (role === "unknown") {
        return <div className="p-6 text-slate-500">Panel hazırlanıyor...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                        {role === "admin" ? "Yönetici Paneli" : role === "accountant" ? "Muhasebe Paneli" : "Montajcı Paneli"}
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                        Hoş geldiniz, işte işletmenizin güncel özeti.
                    </p>
                </div>

                <div className="flex gap-3">
                    <button onClick={refreshAll} className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors">
                        Yenile
                    </button>
                    {(role === "admin" || role === "installer") && (
                        <Link to="/orders/new" className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium shadow-md shadow-primary-600/20 transition-all inline-flex items-center">
                            + Yeni Sipariş
                        </Link>
                    )}
                </div>
            </div>

            {overdueCount > 0 && (
                <div className="bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded-lg mb-4 shadow-sm animate-pulse">
                    Dikkat: {overdueCount} adet geciken randevu var!
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
                {role === "admin" && (
                    <>
                        <StatCard title="Yıllık Toplam Gelir" value={formatTL(stats.totalRevenue)} change="+%12.5" icon={TrendingUp} trend="up" colorClass="from-amber-600 to-amber-800" onClick={() => nav("/accounting")} />
                        <StatCard title="Bekleyen Tahsilatlar" value={formatTL(stats.pendingPayments)} change="Takipte" icon={CreditCard} trend="down" colorClass="from-slate-700 to-slate-900" onClick={() => nav("/accounting")} />
                        <StatCard title="Fiyat Bekleyen Ölçüler" value={String(stats.waitingPricingCount)} change="Acil İş" icon={ClipboardList} trend="up" colorClass="from-orange-500 to-red-600" onClick={() => nav("/orders")} />
                        <StatCard title="Müşteri Portföyü" value={String(stats.totalCustomers)} change="+2" icon={Users} trend="up" colorClass="from-blue-600 to-blue-800" onClick={() => nav("/customers")} />
                    </>
                )}
                {role === "accountant" && (
                    <>
                        <StatCard title="Tahsilat Listesi" value={formatTL(stats.pendingPayments)} change="Ödeme Bekleyen" icon={CreditCard} trend="up" colorClass="from-emerald-600 to-green-800" onClick={() => nav("/accounting")} />
                        <StatCard title="Fiyat Girilecek Ölçüler" value={String(stats.waitingPricingCount)} change="Yeni Kayıt" icon={ClipboardList} trend="up" colorClass="from-orange-500 to-orange-700" onClick={() => nav("/orders")} />
                        <StatCard title="Aktif Sipariş Toplamı" value={formatTL(stats.totalRevenue)} change="Güncel" icon={TrendingUp} trend="up" colorClass="from-blue-500 to-blue-700" onClick={() => nav("/orders")} />
                        <StatCard title="Tamamlanan İşler" value={String(stats.completedWorks)} change="Biten" icon={CheckCircle2} trend="up" colorClass="from-slate-600 to-slate-800" onClick={() => nav("/orders")} />
                    </>
                )}
                {role === "installer" && (
                    <>
                        <StatCard title="Bugünkü Görevlerim" value={String(todayAppts.length)} change="Günün işi" icon={Calendar} trend="up" colorClass="from-indigo-600 to-indigo-800" onClick={() => nav("/route/today")} />
                        <StatCard title="Tamamlanan İşlerim" value={String(stats.completedWorks)} change="Başarı" icon={CheckCircle2} trend="up" colorClass="from-emerald-600 to-emerald-800" onClick={() => nav("/orders")} />
                        <StatCard title="Sipariş Bekleyen Ölçülerim" value={String(stats.waitingPricingCount)} change="Süreçte" icon={ClipboardList} trend="up" colorClass="from-amber-500 to-amber-700" onClick={() => nav("/orders")} />
                        <StatCard title="Toplam Müşteri Portföyüm" value={String(stats.totalCustomers)} change="Aktif" icon={Users} trend="up" colorClass="from-slate-600 to-slate-800" onClick={() => nav("/customers")} />
                    </>
                )}
            </div>

            {role === "admin" && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                        ["Bugünkü Ölçüler", todayAppts.filter((a) => String(a.type ?? "").toLowerCase() === "measurement").length, "/route/today"],
                        ["Bugünkü Montajlar", todayAppts.filter((a) => String(a.type ?? "").toLowerCase() === "installation").length, "/route/today"],
                        ["Bekleyen Siparişler", stats.activeOrders || 0, "/orders"],
                        ["Tahsilat Bekleyenler", formatTL(stats.pendingPayments), "/accounting"],
                    ].map(([label, value, target]) => (
                        <button key={String(label)} type="button" onClick={() => nav(String(target))} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                            <div className="mt-2 text-xl font-black text-slate-950 dark:text-white">{value}</div>
                        </button>
                    ))}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-lg font-semibold">Bugünün Randevuları</h2>
                            {todayLoading && <span className="text-sm text-slate-500">Yükleniyor...</span>}
                        </div>
                        {todayErr && <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200">{todayErr}</div>}
                        {!todayLoading && todayAppts.length === 0 && <div className="text-slate-500">Bugün randevu yok.</div>}
                        <div className="space-y-2">
                            {todayAppts.map((a) => (
                                <button key={a.id} onClick={() => nav(`/appointments/${a.id}`)} className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                                    <div className="flex items-center justify-between">
                                        <div className="font-medium">
                                            {a.title ?? typeTR(a.type)}
                                            <span className="text-sm text-slate-500"> • {pickOne(a.customer)?.name ?? "-"}</span>
                                            {a.assigned_to && staffMap[a.assigned_to] && (
                                                <span className="ml-2 text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 font-bold uppercase">{staffMap[a.assigned_to].full_name}</span>
                                            )}
                                        </div>
                                        <div className="text-sm text-slate-500">{apptIso(a) ? timeTR(apptIso(a)!) : ""}</div>
                                    </div>
                                    <div className="text-sm text-slate-500 mt-1">{a.address ?? ""}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                        <h2 className="text-lg font-semibold mb-3">Geciken Randevular</h2>
                        {overdue.length === 0 && <div className="text-slate-500">Geciken randevu yok</div>}
                        <div className="space-y-2">
                            {overdue.map((a) => (
                                <button key={a.id} onClick={() => nav(`/appointments/${a.id}`)} className="w-full text-left p-3 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 transition">
                                    <div className="flex items-center justify-between">
                                        <div className="font-medium">{a.title ?? typeTR(a.type)} <span className="text-sm text-slate-600">({pickOne(a.customer)?.name ?? "-"})</span></div>
                                        <div className="text-sm text-slate-600">{apptIso(a) ? timeTR(apptIso(a)!) : ""}</div>
                                    </div>
                                    <div className="text-sm text-slate-600 mt-1">{apptIso(a) ? dayKeyTR(apptIso(a)!) : ""} • {a.address ?? ""}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                        <h2 className="text-lg font-semibold mb-3">Takvim</h2>
                        <div className="space-y-5">
                            {calendarDays.map((g) => (
                                <div key={g.day}>
                                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">{g.day}</div>
                                    <div className="space-y-2">
                                        {g.items.map((a) => (
                                            <button key={a.id} onClick={() => nav(`/appointments/${a.id}`)} className={cn("w-full text-left p-3 rounded-xl border transition-colors", isOverdue(a) ? "border-red-300 bg-red-50 hover:bg-red-100" : isDueSoon(a) ? "border-amber-300 bg-amber-50 hover:bg-amber-100" : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800")}>
                                                <div className="flex items-center justify-between">
                                                    <div className="font-medium">
                                                        {apptIso(a) ? timeTR(apptIso(a)!) : ""} • {typeTR(a.type)} • {a.title ?? ""}
                                                        <span className="text-sm text-slate-500"> • {pickOne(a.customer)?.name ?? "-"}</span>
                                                    </div>
                                                    <div className="text-xs text-slate-500">{a.status ?? "planned"}</div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Son Siparişler</h3>
                        <div className="space-y-3">
                            {recentOrders.map((o) => (
                                <button key={o.id} onClick={() => nav(`/orders/${o.id}`)} className="w-full text-left p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border border-transparent hover:border-slate-200">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="font-medium">#{o.id.slice(0, 8)}</div>
                                            <div className="text-xs text-slate-500">{o.customer_name}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-bold">{formatTL(o.total)}</div>
                                            <div className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase", statusBadgeClass(o.status))}>{statusLabel(o.status)}</div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Yaklaşan İşler</h3>
                        <div className="space-y-3">
                            {upcoming.slice(0, 5).map((u) => (
                                <button key={u.id} onClick={() => nav(`/appointments/${u.id}`)} className="w-full text-left p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs", u.type === "installation" ? "bg-green-100 text-green-700" : "bg-primary-100 text-primary-600")}>
                                            {formatTime(apptIso(u))}
                                        </div>
                                        <div>
                                            <div className="text-sm font-medium">{pickOne(u.customer)?.name || "İsimsiz"}</div>
                                            <div className="text-[10px] text-slate-500">{formatDateTR(apptIso(u))} • {typeTR(u.type)}</div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};




