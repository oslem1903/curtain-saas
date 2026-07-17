import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
    ArrowLeft, TrendingUp, Wallet, CreditCard, History, Download,
    AlertCircle, Loader2, Calendar, Package, Printer
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
    transaction_type: "earning" | "payment" | "cancel";
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

            // Hakediş (tamamlanan işler) ve montajcı cari hareketleri (ödeme/iptal)
            // doğrudan okunur. get_installer_cari_summary / get_installer_ledger
            // RPC'leri ARTIK KULLANILMIYOR — bu RPC'ler yalnızca eski, kaldırılmış
            // "earning/payment/adjustment" komisyon sistemine ait 'earning' ve
            // 'adjustment' tiplerini tanıyordu; installer_cancel_payment RPC'sinin
            // ürettiği 'cancel' (ödeme iptali) satırlarını hiç tanımadığı için
            // iptal edilen ödemeler bakiyeden sessizce düşmüyordu. Aşağıdaki
            // hesap InstallerLedger.tsx'teki formülle BİREBİR AYNIDIR:
            //   Hakediş = tamamlanan işlerin installer_fee toplamı
            //   Ödenen  = ödemeler − iptaller
            //   Kalan   = max(Hakediş − Ödenen, 0)
            //   Avans   = max(Ödenen − Hakediş, 0)
            const { data: jobsData, error: jobsError } = await supabase
                .from("installation_jobs")
                .select("id, order_id, installer_fee, scheduled_date, customer_name, product_type, status")
                .eq("assigned_staff_id", installerId)
                .eq("company_id", companyId);
            if (jobsError) throw jobsError;

            const { data: txData, error: txError } = await supabase
                .from("installer_transactions")
                .select("id, transaction_date, transaction_type, amount, description")
                .eq("installer_id", installerId)
                .eq("company_id", companyId);
            if (txError) throw txError;

            const completedJobs = (jobsData ?? []).filter((j) => j.status === "completed");
            const earned = completedJobs.reduce((a, j) => a + Number(j.installer_fee ?? 0), 0);
            const paid = (txData ?? []).reduce(
                (a, t) => a + (t.transaction_type === "payment" ? Number(t.amount) : -Number(t.amount)),
                0,
            );
            const remaining = Math.max(Math.round((earned - paid) * 100) / 100, 0);
            const advance = Math.max(Math.round((paid - earned) * 100) / 100, 0);

            const lastEarningDate = completedJobs.reduce<string | null>((latest, j) => {
                if (!j.scheduled_date) return latest;
                return !latest || j.scheduled_date > latest ? j.scheduled_date : latest;
            }, null);
            const lastPaymentDate = (txData ?? [])
                .filter((t) => t.transaction_type === "payment")
                .reduce<string | null>((latest, t) => {
                    if (!t.transaction_date) return latest;
                    return !latest || t.transaction_date > latest ? t.transaction_date : latest;
                }, null);

            setSummary({
                total_earnings: earned,
                total_paid: paid,
                total_adjustments: advance,
                balance: remaining,
                last_earning_date: lastEarningDate,
                last_payment_date: lastPaymentDate,
                transaction_count: (txData ?? []).length,
            });

            // Hareket geçmişi: hakediş (iş) + ödeme/iptal (installer_transactions)
            // tek kronolojik listede birleştirilir — InstallerLedger.tsx'teki
            // ekstre mantığıyla aynı (running balance = debit − credit kümülatif).
            type RawLine = {
                id: string;
                date: string;
                desc: string;
                debit: number;
                credit: number;
                type: "earning" | "payment" | "cancel";
                orderId: string | null;
                customerName: string | null;
            };
            const rawLines: RawLine[] = [];

            completedJobs.forEach((j) => {
                rawLines.push({
                    id: j.id,
                    date: j.scheduled_date || "",
                    desc: `Hakediş: ${j.customer_name || "Müşteri"}${j.product_type ? ` — ${j.product_type}` : ""}`,
                    debit: Number(j.installer_fee ?? 0),
                    credit: 0,
                    type: "earning",
                    orderId: j.order_id ?? null,
                    customerName: j.customer_name ?? null,
                });
            });

            (txData ?? []).forEach((t) => {
                const amt = Number(t.amount ?? 0);
                const isCancel = t.transaction_type !== "payment";
                rawLines.push({
                    id: t.id,
                    date: t.transaction_date?.slice(0, 10) || "",
                    desc: t.description || (isCancel ? "Ödeme İptali" : "Ödeme"),
                    debit: isCancel ? amt : 0,
                    credit: isCancel ? 0 : amt,
                    type: isCancel ? "cancel" : "payment",
                    orderId: null,
                    customerName: null,
                });
            });

            rawLines.sort((a, b) => a.date.localeCompare(b.date) || (a.type === "earning" ? -1 : 1));

            let running = 0;
            const ledgerRows: LedgerEntry[] = rawLines.map((l) => {
                running = Math.round((running + l.debit - l.credit) * 100) / 100;
                return {
                    id: l.id,
                    transaction_date: l.date,
                    transaction_type: l.type,
                    amount: l.debit || l.credit,
                    description: l.desc,
                    order_id: l.orderId,
                    customer_name: l.customerName,
                    running_balance: running,
                };
            });

            setLedger(ledgerRows.slice().reverse());
        } catch (e: any) {
            setError(e?.message || "Veri yüklenirken hata oluştu");
            console.error("Load error:", e);
        } finally {
            setLoading(false);
        }
    }

    // Cari ekstresi dışa aktarımı — InstallerLedger PDF/CSV deseniyle birebir.
    function handleExportExcel() {
        if (ledger.length === 0) return;
        const headers = ["Tarih", "Sipariş", "Müşteri", "Açıklama", "Montaj Ücreti (+)", "Ödeme (−)", "Bakiye"];
        const rows = ledger.map((e) => {
            const debit = e.transaction_type === "payment" ? 0 : e.amount;
            const credit = e.transaction_type === "payment" ? e.amount : 0;
            return [
                formatDate(e.transaction_date),
                e.order_id ? e.order_id.slice(0, 8).toUpperCase() : "—",
                e.customer_name || "—",
                e.description || "",
                debit > 0 ? debit.toFixed(2) : "0.00",
                credit > 0 ? credit.toFixed(2) : "0.00",
                e.running_balance.toFixed(2),
            ];
        });
        const content = [headers, ...rows].map((r) => r.join(";")).join("\n");
        const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `montajci_${(installer?.name || "isimsiz").toLowerCase().replace(/\s+/g, "_")}_cari_ekstre_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function handleExportPDF() {
        if (ledger.length === 0 || !summary) return;
        const dates = ledger.map((e) => e.transaction_date).filter(Boolean).sort();
        const donem = dates.length > 0 ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}` : "—";
        const rows = ledger
            .map((e) => {
                const debit = e.transaction_type === "payment" ? 0 : e.amount;
                const credit = e.transaction_type === "payment" ? e.amount : 0;
                return `
                    <tr>
                        <td>${formatDate(e.transaction_date)}</td>
                        <td>${e.order_id ? e.order_id.slice(0, 8).toUpperCase() : "—"}</td>
                        <td>${e.customer_name || "—"}</td>
                        <td>${e.description || ""}</td>
                        <td style="text-align: right; color: #dc2626;">${debit > 0 ? `+ ${formatMoney(debit)}` : "—"}</td>
                        <td style="text-align: right; color: #16a34a;">${credit > 0 ? `− ${formatMoney(credit)}` : "—"}</td>
                        <td style="text-align: right; font-weight: bold; color: ${e.running_balance > 0 ? "#b91c1c" : e.running_balance < 0 ? "#1d4ed8" : "#15803d"};">${formatMoney(e.running_balance)}${e.running_balance < 0 ? " (Avans)" : ""}</td>
                    </tr>`;
            })
            .join("");

        const printWindow = window.open("", "_blank", "width=1200,height=800");
        if (!printWindow) return;
        printWindow.document.write(`
            <html>
                <head>
                    <title>Montajcı Cari Ekstresi - ${installer?.name || ""}</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 30px; color: #1e293b; background: #fff; }
                        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #cbd5e1; padding-bottom: 20px; margin-bottom: 30px; }
                        .title h1 { margin: 0; font-size: 24px; font-weight: 800; color: #0f172a; }
                        .title p { margin: 5px 0 0 0; font-size: 14px; color: #64748b; }
                        .details { font-size: 14px; line-height: 1.6; text-align: right; }
                        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
                        .summary-card { padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; }
                        .summary-card .label { font-size: 11px; text-transform: uppercase; font-weight: bold; color: #64748b; }
                        .summary-card .val { font-size: 18px; font-weight: 800; margin-top: 5px; color: #0f172a; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                        th, td { padding: 12px 10px; border-bottom: 1px solid #cbd5e1; font-size: 12px; text-align: left; }
                        th { background: #f1f5f9; font-weight: bold; color: #475569; border-top: 1px solid #cbd5e1; }
                        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div class="title">
                            <h1>MONTAJCI CARİ EKSTRESİ</h1>
                            <p>${installer?.name || "Montajcı"}</p>
                        </div>
                        <div class="details">
                            <div><strong>Tarih:</strong> ${new Date().toLocaleDateString("tr-TR")}</div>
                            <div><strong>Dönem:</strong> ${donem}</div>
                        </div>
                    </div>
                    <div class="summary-grid">
                        <div class="summary-card">
                            <div class="label">Toplam Hakediş</div>
                            <div class="val">${formatMoney(summary.total_earnings)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="label">Toplam Ödenen</div>
                            <div class="val" style="color: #16a34a;">${formatMoney(summary.total_paid)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="label">Kalan Bakiye</div>
                            <div class="val" style="color: ${summary.balance > 0 ? "#dc2626" : "#16a34a"};">${formatMoney(summary.balance)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="label">Avans</div>
                            <div class="val" style="color: #2563eb;">${formatMoney(summary.total_adjustments)}</div>
                        </div>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 90px;">Tarih</th>
                                <th>Sipariş</th>
                                <th>Müşteri</th>
                                <th>Açıklama</th>
                                <th style="text-align: right; width: 120px;">Montaj Ücreti (+)</th>
                                <th style="text-align: right; width: 110px;">Ödeme (−)</th>
                                <th style="text-align: right; width: 120px;">Bakiye</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                    <div class="footer">Bu döküm sistem tarafından otomatik oluşturulmuştur. © PerdePRO</div>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 500);
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
                                <p className="text-xs text-slate-500 dark:text-slate-400">Avans</p>
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
                                                {entry.transaction_type === "cancel" && "İptal"}
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
                    onClick={handleExportPDF}
                    disabled={ledger.length === 0}
                    className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition flex items-center gap-2"
                >
                    <Printer className="h-4 w-4" />
                    PDF / Yazdır
                </button>
                <button
                    onClick={handleExportExcel}
                    disabled={ledger.length === 0}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition flex items-center gap-2"
                >
                    <Download className="h-4 w-4" />
                    Excel / CSV
                </button>
            </div>
        </div>
    );
}
