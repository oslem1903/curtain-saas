import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowUpDown, Calendar, FileText, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";

// ─── Types ───────────────────────────────────────────────────
type SupplierRow = { id: string; name: string };

type TxRow = {
    supplier_id: string;
    transaction_type: "debt" | "payment" | "cancel";
    amount: number;
    transaction_date: string;
};

type SupplierSummary = {
    id: string;
    name: string;
    totalDebt: number;
    totalPaid: number;
    balance: number;
    thisMonthNet: number;   // Bu ay oluşan net borç (bu ayki debt - bu ayki payment)
    overdueNet: number;     // Geçen ay ve öncesi kapanmamış borç
    lastDate: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────
function formatTL(n: number) {
    return new Intl.NumberFormat("tr-TR", {
        style: "currency", currency: "TRY", maximumFractionDigits: 2,
    }).format(Number.isFinite(n) ? n : 0);
}

function formatDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("tr-TR");
}

/** ISO string for the first instant of the current month */
function currentMonthStart(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

// ─── Component ───────────────────────────────────────────────
export default function SupplierCariReport() {
    const nav = useNavigate();

    // Raw data (always unfiltered)
    const [suppliers, setSuppliers]   = useState<SupplierRow[]>([]);
    const [allTxs, setAllTxs]         = useState<TxRow[]>([]);
    const [loading, setLoading]       = useState(true);
    const [err, setErr]               = useState("");

    // Filters / sort
    const [dateFrom, setDateFrom]     = useState("");
    const [dateTo, setDateTo]         = useState("");
    const [hideZero, setHideZero]     = useState(false);
    const [sortBy, setSortBy]         = useState<"balance" | "name">("balance");

    // ── Load ────────────────────────────────────────────────
    useEffect(() => {
        let alive = true;
        async function load() {
            setLoading(true);
            setErr("");
            try {
                const ctx = await getEffectiveTenantContext();

                const [{ data: supData, error: supErr }, { data: txData, error: txErr }] = await Promise.all([
                    supabase.from("suppliers").select("id,name").eq("company_id", ctx.company_id).order("name"),
                    supabase.from("supplier_transactions")
                        .select("supplier_id,transaction_type,amount,transaction_date")
                        .eq("company_id", ctx.company_id),
                ]);

                if (supErr) throw supErr;
                if (txErr) throw txErr;
                if (!alive) return;
                setSuppliers((supData ?? []) as SupplierRow[]);
                setAllTxs((txData ?? []) as TxRow[]);
            } catch (e: any) {
                if (alive) setErr(e?.message ?? "Yüklenemedi.");
            } finally {
                if (alive) setLoading(false);
            }
        }
        load();
        return () => { alive = false; };
    }, []);

    // ── Compute summaries ───────────────────────────────────
    const monthStart = useMemo(() => currentMonthStart(), []);

    const { summaries, grandDebt, grandPaid, grandBalance, grandThisMonth, grandOverdue } = useMemo(() => {
        // Build per-supplier accumulators
        type Acc = {
            // Date-filtered totals (for table display)
            filtDebt: number; filtPaid: number; filtLastDate: string | null;
            // Always-unfiltered: this month
            tmDebt: number; tmPaid: number;
            // Always-unfiltered: before this month
            prevDebt: number; prevPaid: number;
        };

        const map = new Map<string, Acc>();
        for (const s of suppliers) {
            map.set(s.id, { filtDebt: 0, filtPaid: 0, filtLastDate: null, tmDebt: 0, tmPaid: 0, prevDebt: 0, prevPaid: 0 });
        }

        for (const tx of allTxs) {
            const e = map.get(tx.supplier_id);
            if (!e) continue;
            const d = tx.transaction_date;
            const isDebt    = tx.transaction_type === "debt";
            const isCredit  = tx.transaction_type === "payment" || tx.transaction_type === "cancel";

            // Date-range filter (affects main totals in table)
            const inRange = (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo + "T23:59:59");
            if (inRange) {
                if (isDebt)   e.filtDebt += tx.amount;
                if (isCredit) e.filtPaid += tx.amount;
                if (!e.filtLastDate || d > e.filtLastDate) e.filtLastDate = d;
            }

            // Bu Ay: unfiltered by user-date, only current month
            if (d >= monthStart) {
                if (isDebt)   e.tmDebt += tx.amount;
                if (isCredit) e.tmPaid += tx.amount;
            }

            // Önceki aylar: unfiltered
            if (d < monthStart) {
                if (isDebt)   e.prevDebt += tx.amount;
                if (isCredit) e.prevPaid += tx.amount;
            }
        }

        // Build summaries for all suppliers
        const allSummaries: SupplierSummary[] = suppliers.map(s => {
            const e = map.get(s.id)!;
            return {
                id: s.id,
                name: s.name || "İsimsiz",
                totalDebt:    e.filtDebt,
                totalPaid:    e.filtPaid,
                balance:      e.filtDebt - e.filtPaid,
                thisMonthNet: Math.max(0, e.tmDebt - e.tmPaid),
                overdueNet:   Math.max(0, e.prevDebt - e.prevPaid),
                lastDate:     e.filtLastDate,
            };
        });

        // Grand totals always from ALL suppliers (before hideZero filter)
        const active = allSummaries.filter(s => s.totalDebt > 0 || s.totalPaid > 0);
        const gDebt     = active.reduce((a, b) => a + b.totalDebt, 0);
        const gPaid     = active.reduce((a, b) => a + b.totalPaid, 0);
        const gBalance  = active.reduce((a, b) => a + b.balance, 0);
        // Bu Ay and Vadesi Geçmiş: always from all (unfiltered by user-date)
        const gThisMonth = Array.from(map.values()).reduce((a, e) => a + Math.max(0, e.tmDebt - e.tmPaid), 0);
        const gOverdue   = Array.from(map.values()).reduce((a, e) => a + Math.max(0, e.prevDebt - e.prevPaid), 0);

        // Apply hideZero filter and sort for table display
        let displayed = hideZero
            ? active.filter(s => s.balance > 0)
            : active;

        if (sortBy === "balance") {
            displayed = [...displayed].sort((a, b) => b.balance - a.balance);
        } else {
            displayed = [...displayed].sort((a, b) => a.name.localeCompare(b.name, "tr"));
        }

        return {
            summaries:      displayed,
            grandDebt:      gDebt,
            grandPaid:      gPaid,
            grandBalance:   gBalance,
            grandThisMonth: gThisMonth,
            grandOverdue:   gOverdue,
        };
    }, [allTxs, suppliers, dateFrom, dateTo, hideZero, sortBy, monthStart]);

    // ── Quick date presets ──────────────────────────────────
    function setThisMonth() {
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth() + 1;
        const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        setDateFrom(`${y}-${String(m).padStart(2, "0")}-01`);
        setDateTo(`${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`);
    }
    function setLastMonth() {
        const now = new Date();
        const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const last  = new Date(now.getFullYear(), now.getMonth(), 0);
        setDateFrom(first.toISOString().slice(0, 10));
        setDateTo(last.toISOString().slice(0, 10));
    }
    function setThisYear() {
        const y = new Date().getFullYear();
        setDateFrom(`${y}-01-01`);
        setDateTo(`${y}-12-31`);
    }

    // ── Render ──────────────────────────────────────────────
    return (
        <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">

            {/* Başlık */}
            <div className="flex items-center gap-4">
                <button
                    onClick={() => nav(-1)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                    <ArrowLeft className="h-4 w-4" /> Geri
                </button>
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-black text-slate-950 dark:text-white">
                        <FileText className="h-6 w-6 text-primary-600" /> Tedarikçi Cari Raporu
                    </h1>
                    <p className="text-sm text-slate-500">Tedarikçi bazında borç ve ödeme özeti</p>
                </div>
            </div>

            {/* 5 Özet Kart */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {/* Toplam Borç */}
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/20">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-red-600">
                        <TrendingDown className="h-3.5 w-3.5" /> Toplam Borç
                    </div>
                    <div className="mt-2 text-xl font-black text-red-800 dark:text-red-200">{formatTL(grandDebt)}</div>
                </div>

                {/* Toplam Ödeme */}
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                        <TrendingUp className="h-3.5 w-3.5" /> Toplam Ödeme
                    </div>
                    <div className="mt-2 text-xl font-black text-emerald-800 dark:text-emerald-200">{formatTL(grandPaid)}</div>
                </div>

                {/* Kalan Borç */}
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-600">
                        <Wallet className="h-3.5 w-3.5" /> Kalan Borç
                    </div>
                    <div className="mt-2 text-xl font-black text-amber-800 dark:text-amber-200">{formatTL(grandBalance)}</div>
                </div>

                {/* Bu Ay Oluşan Borç */}
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blue-600">
                        <Calendar className="h-3.5 w-3.5" /> Bu Ay
                    </div>
                    <div className="mt-2 text-xl font-black text-blue-800 dark:text-blue-200">{formatTL(grandThisMonth)}</div>
                    <div className="mt-0.5 text-[10px] text-blue-500">bu ayki net borç</div>
                </div>

                {/* Vadesi Geçmiş */}
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/40 dark:bg-rose-950/20">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-rose-600">
                        <AlertTriangle className="h-3.5 w-3.5" /> Vadesi Geçmiş
                    </div>
                    <div className="mt-2 text-xl font-black text-rose-800 dark:text-rose-200">{formatTL(grandOverdue)}</div>
                    <div className="mt-0.5 text-[10px] text-rose-500">geçen ay + öncesi</div>
                </div>
            </div>

            {/* Filtreler */}
            <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                {/* Tarih girdileri */}
                <label>
                    <span className="block text-xs font-bold text-slate-500 mb-1">Başlangıç Tarihi</span>
                    <input
                        type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-800"
                    />
                </label>
                <label>
                    <span className="block text-xs font-bold text-slate-500 mb-1">Bitiş Tarihi</span>
                    <input
                        type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-800"
                    />
                </label>

                {/* Hızlı filtre butonları */}
                <div className="flex flex-wrap gap-2 self-end">
                    <button onClick={setThisMonth}  className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Bu Ay</button>
                    <button onClick={setLastMonth}  className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Geçen Ay</button>
                    <button onClick={setThisYear}   className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Bu Yıl</button>
                    {(dateFrom || dateTo) && (
                        <button
                            onClick={() => { setDateFrom(""); setDateTo(""); }}
                            className="rounded-lg border border-rose-200 px-2.5 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:border-rose-800"
                        >
                            Temizle
                        </button>
                    )}
                </div>

                {/* Sıralama */}
                <div className="ml-auto">
                    <span className="block text-xs font-bold text-slate-500 mb-1">
                        <ArrowUpDown className="inline h-3 w-3 mr-1" />Sıralama
                    </span>
                    <select
                        value={sortBy} onChange={e => setSortBy(e.target.value as "balance" | "name")}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-800"
                    >
                        <option value="balance">En Çok Borçlu Önce</option>
                        <option value="name">İsme Göre (A→Z)</option>
                    </select>
                </div>

                {/* Sıfır bakiye filtresi */}
                <label className="flex cursor-pointer items-center gap-2 self-end py-2">
                    <input
                        type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 accent-primary-600"
                    />
                    <span className="whitespace-nowrap text-sm font-bold text-slate-600 dark:text-slate-300">
                        Sadece borçlular
                    </span>
                </label>
            </div>

            {err && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>
            )}

            {/* Tedarikçi Tablosu */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                {loading ? (
                    <div className="p-8 text-center text-sm text-slate-500">Yükleniyor…</div>
                ) : summaries.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-500">
                        {hideZero ? "Açık bakiyesi olan tedarikçi yok." : "Görüntülenecek tedarikçi yok."}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                                    <th className="px-4 py-3 text-left   text-xs font-black uppercase text-slate-500">Tedarikçi</th>
                                    <th className="px-4 py-3 text-right  text-xs font-black uppercase text-slate-500">Toplam Borç</th>
                                    <th className="px-4 py-3 text-right  text-xs font-black uppercase text-slate-500">Toplam Ödenen</th>
                                    <th className="px-4 py-3 text-right  text-xs font-black uppercase text-slate-500">Kalan Borç</th>
                                    <th className="px-4 py-3 text-right  text-xs font-black uppercase text-slate-500">Bu Ay</th>
                                    <th className="px-4 py-3 text-right  text-xs font-black uppercase text-slate-500">Vadesi Geçmiş</th>
                                    <th className="px-4 py-3 text-right  text-xs font-black uppercase text-slate-500">Son Hareket</th>
                                </tr>
                            </thead>
                            <tbody>
                                {summaries.map((s, i) => (
                                    <tr
                                        key={s.id}
                                        onClick={() => nav(`/suppliers/${s.id}`)}
                                        className={`cursor-pointer border-b border-slate-50 transition hover:bg-primary-50/60 dark:border-slate-800 dark:hover:bg-slate-800/60 ${i % 2 === 0 ? "" : "bg-slate-50/40 dark:bg-slate-950/40"}`}
                                    >
                                        <td className="px-4 py-3 font-black text-slate-900 dark:text-white">
                                            {s.name}
                                            {s.overdueNet > 0 && (
                                                <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-700">
                                                    <AlertTriangle className="h-2.5 w-2.5" /> Vadesi geçmiş
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-red-600">{formatTL(s.totalDebt)}</td>
                                        <td className="px-4 py-3 text-right font-bold text-emerald-600">{formatTL(s.totalPaid)}</td>
                                        <td className={`px-4 py-3 text-right font-black ${s.balance > 0 ? "text-amber-600" : "text-slate-400"}`}>{formatTL(s.balance)}</td>
                                        <td className="px-4 py-3 text-right font-bold text-blue-600">
                                            {s.thisMonthNet > 0 ? formatTL(s.thisMonthNet) : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-rose-600">
                                            {s.overdueNet > 0 ? formatTL(s.overdueNet) : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right text-slate-400">{formatDate(s.lastDate)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-slate-200 bg-slate-50 font-black dark:border-slate-700 dark:bg-slate-950">
                                    <td className="px-4 py-3 text-xs uppercase text-slate-500">Genel Toplam</td>
                                    <td className="px-4 py-3 text-right text-red-700">{formatTL(grandDebt)}</td>
                                    <td className="px-4 py-3 text-right text-emerald-700">{formatTL(grandPaid)}</td>
                                    <td className="px-4 py-3 text-right text-amber-700">{formatTL(grandBalance)}</td>
                                    <td className="px-4 py-3 text-right text-blue-700">{formatTL(grandThisMonth)}</td>
                                    <td className="px-4 py-3 text-right text-rose-700">{formatTL(grandOverdue)}</td>
                                    <td />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
