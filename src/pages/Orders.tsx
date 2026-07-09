import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Plus, Search, Filter, ArrowLeft, RefreshCw } from "lucide-react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { useRole } from "../context/RoleContext";
import { withoutDeleted } from "../utils/softDelete";
import { PAGE_SIZE } from "../constants/pagination";
import { Pagination } from "../components/Pagination";

/** -----------------------
 * Helpers
 * ----------------------*/
async function getContext() {
    return getEffectiveTenantContext();
}

/** -----------------------
 * Types
 * ----------------------*/
type DbCustomer = {
    name: string | null;
    phone: string | null;
};

type DbOrderItem = {
    line_total: number | null;
};

type DbOrder = {
    id: string;
    created_at: string;
    status: string | null;
    note: string | null;
    customer_id: string | null;
    company_id: string | null;
    assigned_to?: string | null;
    assigned_user_id?: string | null;
    created_by?: string | null;
    appointment_id?: string | null;
    total_amount?: number | null;
    paid_amount?: number | null;
    remaining_amount?: number | null;
    customer: DbCustomer | DbCustomer[] | null;
    order_items: DbOrderItem[] | null;
};

function asCustomer(c: DbCustomer | DbCustomer[] | null): DbCustomer | null {
    return Array.isArray(c) ? (c[0] ?? null) : c;
}

function isOrderAssignedTo(order: DbOrder, userId: string) {
    return order.assigned_user_id === userId || order.assigned_to === userId || order.created_by === userId;
}

function formatDateTR(iso: string) {
    try {
        return new Date(iso).toLocaleString("tr-TR");
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

function computeTotalNet(o: DbOrder) {

    if (o.total_amount != null) return Number(o.total_amount ?? 0);

    const items = o.order_items ?? [];
    return items.reduce((acc, it) => acc + Number(it?.line_total ?? 0), 0);
}

function statusLabel(status?: string | null) {
    const s = String(status ?? "").toLowerCase();
    if (s === "new_order") return "Yeni Sipariş";
    if (s === "montaja_hazir") return "Montaja Hazır";
    if (s === "montaj_planlandi") return "Montaj Planlandı";
    if (s === "montajda") return "Montajda";
    if (s === "montaj_tamamlandi") return "Montaj Tamamlandı";
    if (s === "installation_ready") return "Montaja Hazır";
    if (s === "installation_planned") return "Montaj Planlandı";
    if (s === "installing") return "Montajda";
    if (s === "installation_completed") return "Montaj Tamamlandı";
    if (s === "delivered_closed") return "Teslim Edildi / Kapandı";
    if (s === "measured") return "Ölçü Alındı";
    if (s === "quoted" || s === "draft") return "Teklif Verildi";
    if (s === "approved") return "Onaylandı";
    if (s === "production") return "İmalatta";
    if (s === "installation_waiting") return "Montaj Bekliyor";
    if (s === "completed") return "Tamamlandı";
    if (s === "paid") return "Ödendi";
    if (s === "partial") return "Kısmi";
    if (s === "open") return "Açık";
    if (s === "cancelled" || s === "canceled") return "İptal";
    return status || "-";
}

function statusClass(status?: string | null) {
    const s = String(status ?? "").toLowerCase();
    if (s === "paid") {
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    }
    if (s === "partial") {
        return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    }
    if (s === "cancelled" || s === "canceled") {
        return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    }
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
}

export default function Orders() {
    const nav = useNavigate();
    const location = useLocation();
    const newOrderId = (location.state as { newOrderId?: string } | null)?.newOrderId ?? null;

    const [rows, setRows] = useState<DbOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");
    const [q, setQ] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [refreshKey, setRefreshKey] = useState(0);
    const [highlightId, setHighlightId] = useState<string | null>(newOrderId);
    const [page, setPage] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const { effectiveRole: role, realRole, viewingUserId } = useRole();

    // Siparişe dönüştürme / yeni sipariş sonrası: her zaman en üstten başla.
    // (Tarayıcının önceki sayfadan kalan kaydırma konumunu taşımasını engeller.)
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: "auto" });
    }, []);

    // Yeni oluşturulan siparişi birkaç saniye vurgula, sonra söndür.
    useEffect(() => {
        if (!newOrderId) return;
        setHighlightId(newOrderId);
        const t = window.setTimeout(() => setHighlightId(null), 4000);
        return () => window.clearTimeout(t);
    }, [newOrderId]);

    const handleRefresh = () => setRefreshKey(prev => prev + 1);

    useEffect(() => {
        let channel: ReturnType<typeof supabase.channel> | null = null;
        let active = true;

        async function subscribe() {
            try {
                const ctx = await getContext();
                if (!active) return;
                channel = supabase
                    .channel(`orders-live-${ctx.company_id}`)
                    .on(
                        "postgres_changes",
                        {
                            event: "*",
                            schema: "public",
                            table: "orders",
                            filter: `company_id=eq.${ctx.company_id}`,
                        },
                        () => handleRefresh()
                    )
                    .subscribe();
            } catch (e) {
                console.error("Orders realtime error:", e);
            }
        }

        subscribe();
        return () => {
            active = false;
            if (channel) supabase.removeChannel(channel);
        };
    }, []);

    useEffect(() => {
        let alive = true;

        async function load() {
            setLoading(true);
            setErr("");

            try {
                const ctx = await getContext();

                const fullSelect = `
                        id,
                        created_at,
                        status,
                        note,
                        customer_id,
                        company_id,
                        assigned_to,
                        assigned_user_id,
                        created_by,
                        appointment_id,
                        total_amount,
                        paid_amount,
                        remaining_amount,
                        customer:customers(name, phone),
                        order_items:order_items(line_total)
                        `;

                const legacySelect = `
                        id,
                        created_at,
                        status,
                        note,
                        customer_id,
                        company_id,
                        assigned_to,
                        created_by,
                        appointment_id,
                        total_amount,
                        paid_amount,
                        remaining_amount,
                        customer:customers(name, phone),
                        order_items:order_items(line_total)
                        `;

                const query = withoutDeleted(supabase
                    .from("orders")
                    .select(fullSelect, { count: 'exact' })
                    .eq("company_id", ctx.company_id))
                    .order("created_at", { ascending: false })
                    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

                let { data, error, count }: { data: any[] | null; error: any; count: number | null } = await query;

                if (error && String(error.message || "").toLowerCase().includes("assigned_user_id")) {
                    const retryQuery = withoutDeleted(supabase
                        .from("orders")
                        .select(legacySelect, { count: 'exact' })
                        .eq("company_id", ctx.company_id))
                        .order("created_at", { ascending: false })
                        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

                    const retry = await retryQuery;
                    data = retry.data;
                    error = retry.error;
                    count = retry.count;
                }

                if (!alive) return;

                if (error) throw error;

                setTotalPages(Math.ceil((count || 0) / PAGE_SIZE));

                const targetId = (realRole === "super_admin" && viewingUserId) ? viewingUserId : ctx.user.id;
                const scopedRows =
                    (role === "installer" || role === "measurement")
                        ? ((data ?? []) as DbOrder[]).filter((order) => {
                              return isOrderAssignedTo(order, targetId) || (!("assigned_to" in order) && !("created_by" in order));
                          })
                        : ((data ?? []) as DbOrder[]);

                setRows(scopedRows);
            } catch (e: any) {
                if (!alive) return;
                console.error("orders load error:", e);
                setRows([]);
                setErr(e?.message ?? "Siparişler yüklenemedi.");
            } finally {
                if (alive) setLoading(false);
            }
        }

        load();

        return () => {
            alive = false;
        };
    }, [refreshKey, role, viewingUserId, realRole, page]);

    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        const statusValue = statusFilter.toLowerCase();

        return rows.filter((o) => {
            const c = asCustomer(o.customer);
            const name = (c?.name ?? "").toLowerCase();
            const phone = (c?.phone ?? "").toLowerCase();
            const status = (o.status ?? "").toLowerCase();
            const note = (o.note ?? "").toLowerCase();
            const idShort = (o.id ?? "").slice(0, 8).toLowerCase();
            const matchesStatus = statusValue === "all" || status === statusValue;
            const matchesSearch = !s ||
                name.includes(s) ||
                phone.includes(s) ||
                status.includes(s) ||
                note.includes(s) ||
                idShort.includes(s);

            return matchesStatus && matchesSearch;
        });
    }, [rows, q, statusFilter]);

    const summary = useMemo(() => {
        const totalOrders = filtered.length;
        const totalNet = filtered.reduce((acc, o) => acc + computeTotalNet(o), 0);
        const totalPaid = filtered.reduce((acc, o) => acc + Number(o.paid_amount ?? 0), 0);
        const totalRemaining = filtered.reduce((acc, o) => {
            const total = computeTotalNet(o);
            const paid = Number(o.paid_amount ?? 0);
            const remaining =
                o.remaining_amount != null
                    ? Number(o.remaining_amount ?? 0)
                    : Math.max(total - paid, 0);

            return acc + remaining;
        }, 0);

        return {
            totalOrders,
            totalNet,
            totalPaid,
            totalRemaining,
        };
    }, [filtered]);

    return (
        <div className="p-4 sm:p-6 space-y-4 overflow-x-hidden">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => nav(-1)}
                        className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 transition shadow-sm"
                        title="Geri Git"
                    >
                        <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
                    </button>
                    <div className="min-w-0">

                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                        Siparişler
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Siparişlerinizi yönetin ve yeni sipariş oluşturun.
                    </p>
                </div>
                </div>

                <div className="flex gap-2 w-full sm:w-auto">
                    <button
                        onClick={handleRefresh}
                        className="inline-flex flex-1 sm:flex-initial items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition font-medium"
                    >
                        <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                        Yenile
                    </button>


                <Link
                    to="/orders/new"
                    className="inline-flex flex-1 sm:flex-initial items-center justify-center gap-2 px-4 py-3 sm:py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm font-medium"
                >
                    <Plus size={18} />
                    Yeni Sipariş
                </Link>
            </div>

            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                    <div className="text-sm text-slate-500">Sipariş Sayısı</div>
                    <div className="text-xl font-bold text-slate-900 dark:text-white mt-2 break-words">
                        {summary.totalOrders}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                    <div className="text-sm text-slate-500">Toplam Sipariş</div>
                    <div className="text-xl font-bold text-slate-900 dark:text-white mt-2 break-words">
                        {formatTL(summary.totalNet)}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                    <div className="text-sm text-slate-500">Toplam Ödenen</div>
                    <div className="text-xl font-bold text-green-600 mt-2 break-words">
                        {formatTL(summary.totalPaid)}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                    <div className="text-sm text-slate-500">Toplam Kalan</div>
                    <div className="text-xl font-bold text-red-600 mt-2 break-words">
                        {formatTL(summary.totalRemaining)}
                    </div>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="w-full sm:flex-1 relative">
                    <Search
                        size={18}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Sipariş ara (isim / tel / durum / not / sipariş no)..."
                        className="w-full min-w-0 pl-10 pr-3 py-3 sm:py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <label className="relative w-full sm:w-56">
                    <Filter
                        size={18}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-8 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 sm:py-2"
                    >
                        <option value="all">Tüm durumlar</option>
                        {/* İş akışı statüleri */}
                        <option value="new_order">Yeni Sipariş</option>
                        <option value="draft">Teklif / Taslak</option>
                        <option value="measured">Ölçü Alındı</option>
                        <option value="quoted">Teklif Verildi</option>
                        <option value="approved">Onaylandı</option>
                        <option value="production">İmalatta</option>
                        <option value="installation_waiting">Montaj Bekliyor</option>
                        <option value="installation_ready">Montaja Hazır</option>
                        <option value="installation_planned">Montaj Planlandı</option>
                        <option value="installing">Montajda</option>
                        <option value="installation_completed">Montaj Tamamlandı</option>
                        <option value="completed">Tamamlandı</option>
                        <option value="cancelled">İptal</option>
                    </select>
                </label>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col">
                <div className="flex-1">
                    {loading ? (
                        <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                            Yükleniyor...
                        </div>
                    ) : err ? (
                        <div className="p-8 text-center text-red-600">{err}</div>
                    ) : filtered.length === 0 ? (
                        <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                            Sipariş bulunamadı. Başlamak için yeni bir sipariş oluşturun.
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-200 dark:divide-slate-800">
                            {filtered.map((o) => {
                                const totalNet = computeTotalNet(o);
                                const paid = Number(o.paid_amount ?? 0);
                                const remaining =
                                    o.remaining_amount != null
                                        ? Number(o.remaining_amount ?? 0)
                                        : Math.max(totalNet - paid, 0);

                                const c = asCustomer(o.customer);
                                const name = c?.name || "İsimsiz Müşteri";
                                const phone = c?.phone ? ` • ${c.phone}` : "";

                                return (
                                    <Link
                                        key={o.id}
                                        to={`/orders/${o.id}`}
                                        ref={(el) => { if (el && highlightId === o.id) el.scrollIntoView({ block: "nearest" }); }}
                                        className={`block p-4 transition ${
                                            highlightId === o.id
                                                ? "bg-emerald-50 ring-2 ring-inset ring-emerald-400 dark:bg-emerald-900/20"
                                                : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                                        }`}
                                    >
                                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                                            <div className="min-w-0">
                                                <div className="font-semibold text-slate-900 dark:text-white break-words">
                                                    {name}
                                                    <span className="text-slate-500 dark:text-slate-400 font-normal">
                                                        {phone}
                                                    </span>
                                                </div>

                                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                                                    <span>{formatDateTR(o.created_at)}</span>
                                                    <span>•</span>
                                                    <span
                                                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(
                                                            o.status
                                                        )}`}
                                                    >
                                                        {statusLabel(o.status)}
                                                    </span>
                                                <span>•</span>
                                                <span className="text-blue-600">#{o.id.slice(0, 8)}</span>
                                            </div>

                                            {o.note ? (
                                                <div className="text-sm text-slate-600 dark:text-slate-300 mt-2 line-clamp-1">
                                                    {o.note}
                                                </div>
                                            ) : null}
                                        </div>

                                        <div className="w-full sm:w-auto sm:min-w-[150px] grid grid-cols-3 sm:block gap-3 text-left sm:text-right">
                                            <div className="font-semibold text-slate-900 dark:text-white">
                                                {formatTL(totalNet)}
                                            </div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                                Net Toplam
                                            </div>

                                            <div className="mt-2 text-sm font-medium text-green-600">
                                                {formatTL(paid)}
                                            </div>
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                                Ödenen
                                            </div>

                                            <div className="mt-1 text-sm font-medium text-red-600">
                                                {formatTL(remaining)}
                                            </div>
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                                Kalan
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                        </div>
                    )}
                </div>

                {!loading && !err && filtered.length > 0 && totalPages > 0 && (
                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        isLoading={loading}
                    />
                )}
            </div>
        </div>
    );
}
