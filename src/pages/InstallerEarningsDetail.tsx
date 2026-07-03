import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
    ArrowLeft, TrendingUp, Wallet, CreditCard, History, Download,
    AlertCircle, Loader2, Calendar, Package
} from "lucide-react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";

type InstallerSummary = {
    total_earnings: number;
    total_paid: number;
    total_adjustments: number;
    balance: number;
    last_earning_date: string | null;
    last_payment_date: string | null;
    transaction_count: number;
};

type LedgerEntry = {
    id: string;
    transaction_date: string;
    transaction_type: "earning" | "payment" | "adjustment";
    amount: number;
    description: string;
    order_id: string | null;
    customer_name: string | null;
    running_balance: number;
};

type InstallerProfile = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    commission_type: "quantity" | "area" | "hybrid" | "manual";
    commission_quantity_rate: number;
    commission_area_rate: number;
};

function formatMoney(value: number) {
    return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

function formatDate(dateStr: string | null) {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleDateString("tr-TR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export default function InstallerEarningsDetail() {
    const navigate = useNavigate();
    const { installerId } = useParams<{ installerId: string }>();

    const [installer, setInstaller] = useState<InstallerProfile | null>(null);
    const [summary, setSummary] = useState<InstallerSummary | null>(null);
    const [ledger, setLedger] = useState<LedgerEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        load();
    }, [installerId]);

    async function load() {
        try {
            setLoading(true);
            setError("");

            const context = await getEffectiveTenantContext();
            if (!context) {
                setError("Kişi bağlamı bulunamadı");
                return;
            }

            const { company_id: companyId } = context;
            if (!installerId) {
                setError("Montajcı ID bulunamadı");
                return;
            }

            // Get installer profile
            const { data: installerData, error: installerError } = await supabase
                .from("employees")
                .select("id, name:full_name, email, phone, commission_type, commission_quantity_rate, commission_area_rate")
                .eq("id", installerId)
                .eq("company_id", companyId)
                .single();

            if (installerError) throw installerError;
            setInstaller(installerData as InstallerProfile);

            // Get cari summary using RPC
            const { data: summaryData, error: summaryError } = await supabase
                .rpc("get_installer_cari_summary", {
                    p_installer_id: installerId,
                    p_company_id: companyId,
                });

            if (summaryError) throw summaryError;
            if (summaryData && summaryData.length > 0) {
                setSummary(summaryData[0]);
            }

            // Get ledger using RPC
            const { data: ledgerData, error: ledgerError } = await supabase
                .rpc("get_installer_ledger", {
                    p_installer_id: installerId,
                    p_company_id: companyId,
                    p_limit: 100,
                });

            if (ledgerError) throw ledgerError;
            setLedger(ledgerData || []);
        } catch (e: any) {
            setError(e?.message || "Veri yüklenirken hata oluştu");
            console.error("Load error:", e);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    <span className="text-sm text-slate-600">Yükleniyor...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-6">
            {/* Header */}
            <div className="mb-6 flex items-center gap-4">
                <button
                    onClick={() => navigate(-1)}
                    className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition"
                >
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <div>
                    <h1 className="text-2xl font-bold">{installer?.name || "Montajcı"}</h1>
                    <p className="text-sm text-slate-500">Hakediş ve Cari Detayları</p>
                </div>
            </div>

            {error && (
                <div className="mb-6 rounded-lg bg-rose-50 border border-rose-200 p-4 flex items-start gap-3 dark:bg-rose-950/20 dark:border-rose-800">
                    <AlertCircle className="h-5 w-5 text-rose-600 mt-0.5 flex-shrink-0" />
                    <div>
                        <h3 className="font-semibold text-rose-900 dark:text-rose-200">Hata</h3>
                        <p className="text-sm text-rose-800 dark:text-rose-300">{error}</p>
                    </div>
                </div>
            )}

            {/* Commission Settings */}
            {installer && (
                <div className="mb-6 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6">
                    <h2 className="text-lg font-semibold mb-4">Hakediş Ayarları</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded">
                            <p className="text-xs text-slate-600 dark:text-slate-400">Hakediş Türü</p>
                            <p className="font-semibold text-sm mt-1">
                                {installer.commission_type === "quantity" && "Adet Bazlı"}
                                {installer.commission_type === "area" && "m² Bazlı"}
                                {installer.commission_type === "hybrid" && "Hibrit (Adet + m²)"}
                                {installer.commission_type === "manual" && "Manuel"}
                            </p>
                        </div>
                        {(installer.commission_type === "quantity" || installer.commission_type === "hybrid") && (
                            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded">
                                <p className="text-xs text-slate-600 dark:text-slate-400">Adet Birim Fiyatı</p>
                                <p className="font-semibold text-sm mt-1">{formatMoney(installer.commission_quantity_rate)}</p>
                            </div>
                        )}
                        {(installer.commission_type === "area" || installer.commission_type === "hybrid") && (
                            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded">
                                <p className="text-xs text-slate-600 dark:text-slate-400">m² Birim Fiyatı</p>
                                <p className="font-semibold text-sm mt-1">{formatMoney(installer.commission_area_rate)}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Summary Cards */}
            {summary && (
                <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Total Earnings */}
                    <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-xs text-slate-500 dark:text-slate-400">Toplam Hakediş</p>
                                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                                    {formatMoney(summary.total_earnings)}
                                </p>
                            </div>
                            <TrendingUp className="h-8 w-8 text-emerald-500 opacity-20" />
                        </div>
                    </div>

                    {/* Total Paid */}
                    <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-xs text-slate-500 dark:text-slate-400">Toplam Ödeme</p>
                                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                                    {formatMoney(summary.total_paid)}
                                </p>
                            </div>
                            <CreditCard className="h-8 w-8 text-blue-500 opacity-20" />
                        </div>
                    </div>

                    {/* Adjustments */}
                    <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-xs text-slate-500 dark:text-slate-400">Düzeltmeler</p>
                                <p className={`text-2xl font-bold mt-1 ${summary.total_adjustments >= 0 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>
                                    {formatMoney(summary.total_adjustments)}
                                </p>
                            </div>
                            <Package className="h-8 w-8 opacity-20" />
                        </div>
                    </div>

                    {/* Balance */}
                    <div className={`rounded-lg border p-4 ${summary.balance >= 0
                        ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800"
                        : "bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800"
                        }`}>
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-xs text-slate-500 dark:text-slate-400">Bakiye</p>
                                <p className={`text-2xl font-bold mt-1 ${summary.balance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                    {formatMoney(summary.balance)}
                                </p>
                            </div>
                            <Wallet className="h-8 w-8 opacity-20" />
                        </div>
                    </div>
                </div>
            )}

            {/* Last Transactions */}
            {summary && (
                <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold mb-2">
                            <TrendingUp className="h-4 w-4" />
                            Son Hakediş
                        </div>
                        <p>{summary.last_earning_date ? formatDate(summary.last_earning_date) : "Henüz hakediş yok"}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold mb-2">
                            <CreditCard className="h-4 w-4" />
                            Son Ödeme
                        </div>
                        <p>{summary.last_payment_date ? formatDate(summary.last_payment_date) : "Henüz ödeme yok"}</p>
                    </div>
                </div>
            )}

            {/* Ledger / Transaction History */}
            <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                    <History className="h-5 w-5" />
                    <h2 className="text-lg font-semibold">Hareket Tarihi ({ledger.length})</h2>
                </div>

                {ledger.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                        <p>Henüz hareket kaydı yok</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="text-left px-6 py-3 font-semibold">Tarih</th>
                                    <th className="text-left px-6 py-3 font-semibold">Tür</th>
                                    <th className="text-left px-6 py-3 font-semibold">Açıklama</th>
                                    <th className="text-left px-6 py-3 font-semibold">Müşteri</th>
                                    <th className="text-right px-6 py-3 font-semibold">Tutar</th>
                                    <th className="text-right px-6 py-3 font-semibold">Bakiye</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ledger.map((entry) => (
                                    <tr
                                        key={entry.id}
                                        className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition"
                                    >
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <Calendar className="h-4 w-4 text-slate-400" />
                                                {formatDate(entry.transaction_date)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                                                entry.transaction_type === "earning"
                                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                                    : entry.transaction_type === "payment"
                                                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                            }`}>
                                                {entry.transaction_type === "earning" && "Hakediş"}
                                                {entry.transaction_type === "payment" && "Ödeme"}
                                                {entry.transaction_type === "adjustment" && "Düzeltme"}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">{entry.description}</td>
                                        <td className="px-6 py-4">{entry.customer_name || "-"}</td>
                                        <td className={`px-6 py-4 text-right font-semibold ${
                                            entry.transaction_type === "earning"
                                                ? "text-emerald-600 dark:text-emerald-400"
                                                : entry.transaction_type === "payment"
                                                ? "text-blue-600 dark:text-blue-400"
                                                : "text-amber-600 dark:text-amber-400"
                                        }`}>
                                            {entry.transaction_type === "payment" ? "-" : "+"}{formatMoney(Math.abs(entry.amount))}
                                        </td>
                                        <td className="px-6 py-4 text-right font-semibold text-slate-900 dark:text-slate-100">
                                            {formatMoney(entry.running_balance)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Footer Actions */}
            <div className="mt-6 flex justify-end gap-2">
                <button
                    onClick={load}
                    className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                >
                    Yenile
                </button>
                <button
                    onClick={() => {
                        // Export functionality
                        alert("Excel dışa aktarma işlevi yakında eklenecek");
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
                >
                    <Download className="h-4 w-4" />
                    Dışa Aktar
                </button>
            </div>
        </div>
    );
}
