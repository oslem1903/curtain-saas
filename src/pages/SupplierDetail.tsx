import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Plus, TrendingDown, TrendingUp, Wallet, X, ChevronDown, Download, Printer, FileSpreadsheet } from "lucide-react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";

type Supplier = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
};

type Transaction = {
    id: string;
    transaction_date: string;
    transaction_type: "debt" | "payment" | "cancel";
    amount: number;
    description: string | null;
    reference_no: string | null;
    payment_method: string | null;
    order_id: string | null;
};

function formatTL(n: number) {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function SupplierDetail() {
    const { id } = useParams<{ id: string }>();
    const nav = useNavigate();

    const [supplier, setSupplier] = useState<Supplier | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");
    const [success, setSuccess] = useState("");
    const [showPaymentForm, setShowPaymentForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showExportDropdown, setShowExportDropdown] = useState(false);

    const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
    const [payAmount, setPayAmount] = useState("");
    const [payMethod, setPayMethod] = useState("nakit");
    const [payNote, setPayNote] = useState("");

    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");

    const load = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        setErr("");
        try {
            const ctx = await getEffectiveTenantContext();

            const { data: sup, error: supErr } = await supabase
                .from("suppliers")
                .select("id,name,phone,email,address")
                .eq("id", id)
                .eq("company_id", ctx.company_id)
                .single();

            if (supErr) throw supErr;
            setSupplier(sup as Supplier);

            // Use RPC for optimized ledger query
            const { data: ledger, error: ledgerErr } = await supabase.rpc("get_supplier_ledger", {
                p_supplier_id: id,
                p_company_id: ctx.company_id,
                p_limit: 100
            });

            if (ledgerErr) {
                // RPC bazı kurulumlarda yok ("schema cache" / 404). Doğrudan
                // supplier_transactions sorgusuna düş — Suppliers.tsx ile aynı yaklaşım.
                const { data: txRows, error: txErr } = await supabase
                    .from("supplier_transactions")
                    .select("id, transaction_date, transaction_type, amount, description, reference_no, payment_method, order_id")
                    .eq("company_id", ctx.company_id)
                    .eq("supplier_id", id)
                    .order("transaction_date", { ascending: false })
                    .limit(100);

                if (txErr) throw txErr;

                setTransactions((txRows ?? []) as Transaction[]);
            } else {
                // Map RPC result to Transaction type
                const mappedTxs = (ledger ?? []).map((tx: any) => ({
                    id: tx.id,
                    transaction_date: tx.transaction_date,
                    transaction_type: tx.transaction_type,
                    amount: tx.amount,
                    description: tx.description,
                    reference_no: tx.reference_no,
                    payment_method: null,
                    order_id: tx.order_id
                }));

                setTransactions(mappedTxs as Transaction[]);
            }
        } catch (e: any) {
            setErr(e?.message ?? "Yüklenemedi.");
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { load(); }, [load]);

    const totalDebt   = transactions.filter(t => t.transaction_type === "debt").reduce((a, b) => a + b.amount, 0);
    const totalPaid   = transactions.filter(t => t.transaction_type === "payment").reduce((a, b) => a + b.amount, 0);
    const totalCancel = transactions.filter(t => t.transaction_type === "cancel").reduce((a, b) => a + b.amount, 0);
    const balance     = totalDebt - totalPaid - totalCancel;

    const lastPaymentDate = useMemo(() => {
        const payments = transactions.filter(t => t.transaction_type === "payment" || t.transaction_type === "cancel");
        if (payments.length === 0) return null;
        return payments.sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))[0].transaction_date;
    }, [transactions]);

    const lastMovementDate = useMemo(() => {
        if (transactions.length === 0) return null;
        return transactions.sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))[0].transaction_date;
    }, [transactions]);

    async function handleAddPayment() {
        const amount = parseFloat(payAmount.replace(",", "."));
        if (!amount || amount <= 0) { setErr("Geçerli bir tutar girin."); return; }
        setSaving(true);
        setErr("");
        try {
            const ctx = await getEffectiveTenantContext();
            if (ctx.readOnly) throw new Error("Firma lisansı aktif değil.");

            const { error } = await supabase.from("supplier_transactions").insert({
                company_id: ctx.company_id,
                supplier_id: id,
                transaction_date: new Date(payDate).toISOString(),
                transaction_type: "payment",
                amount,
                description: payNote.trim() || `${payMethod} ödemesi`,
                payment_method: payMethod,
            });

            if (error) throw error;

            await supabase.from("supplier_payments").insert({
                company_id: ctx.company_id,
                supplier_id: id,
                payment_date: new Date(payDate).toISOString(),
                amount,
                payment_method: payMethod,
                note: payNote.trim() || null,
            });

            // Gider kaydı — Muhasebe "Toplam Gider" ile senkron
            await supabase.from("expenses").insert({
                company_id: ctx.company_id,
                supplier_id: id,
                amount,
                expense_date: new Date(payDate).toISOString(),
                category: "Tedarik",
                status: "paid",
                note: payNote.trim() || `${supplier?.name || "Tedarikçi"} ödemesi`,
            });

            setSuccess("Ödeme kaydedildi.");
            setPayAmount("");
            setPayNote("");
            setShowPaymentForm(false);
            await load();
        } catch (e: any) {
            setErr(e?.message ?? "Ödeme kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    }

    const rowsWithBalance = useMemo(() => {
        const sorted = [...transactions].sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
        let running = 0;
        return sorted.map((tx) => {
            if (tx.transaction_type === "debt") running += tx.amount;
            else running -= tx.amount;
            return { tx, balance: running };
        });
    }, [transactions]);

    function handleExportExcel() {
        if (rowsWithBalance.length === 0) return;

        const headers = ["Tarih", "Açıklama", "Evrak No", "Borç (+)", "Ödeme (-)", "Bakiye"];
        const rows = [...rowsWithBalance].reverse().map(({ tx, balance: bal }) => [
            formatDate(tx.transaction_date),
            tx.description || "",
            tx.reference_no || "",
            tx.transaction_type === "debt" ? tx.amount.toFixed(2) : "0.00",
            tx.transaction_type === "payment" || tx.transaction_type === "cancel" ? tx.amount.toFixed(2) : "0.00",
            bal.toFixed(2)
        ]);

        const content = [headers, ...rows].map((row) => row.join(";")).join("\n");
        const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `tedarikci_${(supplier?.name || "isimsiz").toLowerCase().replace(/\s+/g, "_")}_cari_ekstre_${new Date().toISOString().slice(0, 10)}.csv`);
        // Bazı tarayıcılar (Chromium) DOM'a bağlı olmayan <a download> üzerinde
        // programatik click'i indirmeye çevirmez — ekle, tıkla, kaldır.
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function handleExportPDF() {
        if (rowsWithBalance.length === 0) return;

        const rows = [...rowsWithBalance]
            .reverse()
            .map(
                ({ tx, balance: bal }) => `
                    <tr>
                        <td>${formatDate(tx.transaction_date)}</td>
                        <td>${tx.description || ""}</td>
                        <td>${tx.reference_no || "—"}</td>
                        <td style="text-align: right; color: #dc2626;">${tx.transaction_type === "debt" ? `+ ${formatTL(tx.amount)}` : "—"}</td>
                        <td style="text-align: right; color: #16a34a;">${tx.transaction_type === "payment" || tx.transaction_type === "cancel" ? `− ${formatTL(tx.amount)}` : "—"}</td>
                        <td style="text-align: right; font-weight: bold; color: ${bal > 0 ? "#b91c1c" : "#15803d"};">
                            ${formatTL(bal)}
                        </td>
                    </tr>`,
            )
            .join("");

        const printWindow = window.open("", "_blank", "width=1200,height=800");
        if (!printWindow) return;

        printWindow.document.write(`
            <html>
                <head>
                    <title>Tedarikçi Cari Ekstresi - ${supplier?.name}</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 30px; color: #1e293b; background: #fff; }
                        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #cbd5e1; padding-bottom: 20px; margin-bottom: 30px; }
                        .title h1 { margin: 0; font-size: 24px; font-weight: 800; color: #0f172a; }
                        .title p { margin: 5px 0 0 0; font-size: 14px; color: #64748b; }
                        .details { font-size: 14px; line-height: 1.6; }
                        .summary-grid { display: grid; grid-template-cols: repeat(3, 1fr); gap: 15px; margin-bottom: 30px; }
                        .summary-card { padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; }
                        .summary-card .label { font-size: 11px; text-transform: uppercase; font-weight: bold; color: #64748b; }
                        .summary-card .val { font-size: 18px; font-weight: 800; margin-top: 5px; color: #0f172a; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                        th, td { padding: 12px 10px; border-bottom: 1px solid #cbd5e1; font-size: 12px; text-align: left; }
                        th { background: #f1f5f9; font-weight: bold; color: #475569; border-top: 1px solid #cbd5e1; }
                        .text-right { text-align: right; }
                        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div class="title">
                            <h1>TEDARİKÇİ CARİ EKSTRESİ</h1>
                            <p>${supplier?.name}</p>
                        </div>
                        <div class="details">
                            <div><strong>Tarih:</strong> ${new Date().toLocaleDateString("tr-TR")}</div>
                            <div><strong>Filtre Aralığı:</strong> ${dateFrom || dateTo ? `${dateFrom ? formatDate(dateFrom) : "—"} - ${dateTo ? formatDate(dateTo) : "—"}` : "Tüm Zamanlar"}</div>
                        </div>
                    </div>

                    <div class="summary-grid">
                        <div class="summary-card">
                            <div class="label">Toplam Borç</div>
                            <div class="val" style="color: #dc2626;">${formatTL(totalDebt)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="label">Toplam Ödenen</div>
                            <div class="val" style="color: #16a34a;">${formatTL(totalPaid + totalCancel)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="label">Kalan Bakiye</div>
                            <div class="val" style="color: ${balance > 0 ? "#b91c1c" : "#15803d"};">${formatTL(balance)}</div>
                        </div>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th style="width: 100px;">Tarih</th>
                                <th>Açıklama</th>
                                <th style="width: 120px;">Evrak No</th>
                                <th style="text-align: right; width: 120px;">Borç (+)</th>
                                <th style="text-align: right; width: 120px;">Ödeme (−)</th>
                                <th style="text-align: right; width: 120px;">Kalan</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>

                    <div class="footer">
                        Bu döküm sistem tarafından otomatik oluşturulmuştur. © PerdePRO
                    </div>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
        }, 500);
    }

    if (loading) return <div className="p-10 text-center text-sm text-slate-500">Yükleniyor...</div>;
    if (!supplier) return <div className="p-10 text-center text-sm text-slate-500">Tedarikçi bulunamadı.</div>;

    return (
        <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8 pb-20">
            <div className="flex items-center justify-between">
                <button onClick={() => nav(-1)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold hover:bg-slate-50 dark:border-slate-700">
                    <ArrowLeft className="h-4 w-4" /> Geri
                </button>
                <button onClick={() => setShowPaymentForm(true)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">
                    <Plus className="h-4 w-4" /> Ödeme Ekle
                </button>
            </div>

            {/* Firma Bilgileri */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h1 className="text-2xl font-black text-slate-950 dark:text-white">{supplier.name}</h1>
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-500">
                    {supplier.phone && <span>📞 {supplier.phone}</span>}
                    {supplier.email && <span>✉️ {supplier.email}</span>}
                    {supplier.address && <span>📍 {supplier.address}</span>}
                </div>
            </div>

            {/* Özet Kartlar — 5 kart */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {/* Toplam Borç */}
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-900/40 dark:bg-red-950/20">
                    <div className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-300">
                        <TrendingDown className="h-4 w-4" /> Toplam Borç
                    </div>
                    <div className="mt-2 text-xl font-black text-red-800 dark:text-red-200">{formatTL(totalDebt)}</div>
                </div>

                {/* Toplam Ödenen */}
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        <TrendingUp className="h-4 w-4" /> Toplam Ödenen
                    </div>
                    <div className="mt-2 text-xl font-black text-emerald-800 dark:text-emerald-200">{formatTL(totalPaid + totalCancel)}</div>
                </div>

                {/* Kalan Bakiye */}
                <div className={`rounded-2xl border p-5 ${balance > 0 ? "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20" : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"}`}>
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                        <Wallet className="h-4 w-4" /> Kalan Bakiye
                    </div>
                    <div className={`mt-2 text-xl font-black ${balance > 0 ? "text-amber-700 dark:text-amber-300" : "text-slate-800 dark:text-slate-200"}`}>{formatTL(balance)}</div>
                    {balance > 0 && <div className="mt-1 text-[10px] font-bold text-amber-600">⚠️ Ödenmemiş borç var</div>}
                </div>

                {/* Son Ödeme Tarihi */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950">
                    <div className="text-xs font-bold text-slate-500">Son Ödeme</div>
                    <div className="mt-2 text-sm font-black text-slate-800 dark:text-slate-200">
                        {lastPaymentDate ? formatDate(lastPaymentDate) : "—"}
                    </div>
                </div>

                {/* Son Hareket Tarihi */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950">
                    <div className="text-xs font-bold text-slate-500">Son Hareket</div>
                    <div className="mt-2 text-sm font-black text-slate-800 dark:text-slate-200">
                        {lastMovementDate ? formatDate(lastMovementDate) : "—"}
                    </div>
                </div>
            </div>

            {err && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
            {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>}

            {/* Ödeme Formu */}
            {showPaymentForm && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                    <div className="mb-4 flex items-center justify-between">
                        <h3 className="font-black text-emerald-900 dark:text-emerald-100">Ödeme Ekle</h3>
                        <button onClick={() => setShowPaymentForm(false)}><X className="h-4 w-4 text-slate-500" /></button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label>
                            <span className="text-xs font-bold text-slate-500">Ödeme Tarihi</span>
                            <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900" />
                        </label>
                        <label>
                            <span className="text-xs font-bold text-slate-500">Tutar (TL)</span>
                            <input type="number" min={0} value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0.00" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900" />
                        </label>
                        <label>
                            <span className="text-xs font-bold text-slate-500">Ödeme Tipi</span>
                            <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900">
                                <option value="nakit">Nakit</option>
                                <option value="eft">EFT</option>
                                <option value="havale">Havale</option>
                                <option value="kredi_karti">Kredi Kartı</option>
                            </select>
                        </label>
                        <label>
                            <span className="text-xs font-bold text-slate-500">Açıklama</span>
                            <input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="Ödeme notu..." className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900" />
                        </label>
                    </div>
                    <button onClick={handleAddPayment} disabled={saving} className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60">
                        {saving ? "Kaydediliyor..." : "Ödemeyi Kaydet"}
                    </button>
                </div>
            )}

            {/* Tarih Filtresi */}
            <div className="flex flex-wrap items-end gap-3">
                <label>
                    <span className="text-xs font-bold text-slate-500">Başlangıç</span>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="mt-1 block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-900" />
                </label>
                <label>
                    <span className="text-xs font-bold text-slate-500">Bitiş</span>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="mt-1 block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-900" />
                </label>
                {(dateFrom || dateTo) && (
                    <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold hover:bg-slate-50 dark:border-slate-700">
                        Filtreyi Temizle
                    </button>
                )}
            </div>

            {/* Cari Hareket Listesi */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                <div className="border-b border-slate-100 p-4 dark:border-slate-800 flex items-center justify-between relative">
                    <h2 className="font-black text-slate-950 dark:text-white">Cari Hareketler</h2>
                    <div>
                        <button
                            type="button"
                            onClick={() => setShowExportDropdown((prev) => !prev)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Döküm Al
                            <ChevronDown className="h-3 w-3" />
                        </button>
                        {showExportDropdown && (
                            <>
                                <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setShowExportDropdown(false)}
                                />
                                <div className="absolute right-0 mt-1 w-40 rounded-xl border border-slate-100 bg-white p-1 shadow-lg dark:border-slate-800 dark:bg-slate-900 z-20 animate-in fade-in duration-100">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowExportDropdown(false);
                                            handleExportPDF();
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                                    >
                                        <Printer className="h-3.5 w-3.5 text-slate-400" />
                                        PDF İndir
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowExportDropdown(false);
                                            handleExportExcel();
                                        }}
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                                    >
                                        <FileSpreadsheet className="h-3.5 w-3.5 text-slate-400" />
                                        Excel İndir
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
                {transactions.length === 0 ? (
                    <div className="p-6 text-sm text-slate-500">Henüz hareket yok.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                                    <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500">Tarih</th>
                                    <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500">Açıklama</th>
                                    <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500">Evrak No</th>
                                    <th className="px-4 py-3 text-right text-xs font-black uppercase text-slate-500">Borç (+)</th>
                                    <th className="px-4 py-3 text-right text-xs font-black uppercase text-slate-500">Ödeme (−)</th>
                                    <th className="px-4 py-3 text-right text-xs font-black uppercase text-slate-500">Kalan</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(() => {
                                    const rows = [...rowsWithBalance].reverse();
                                    return rows.map(({ tx, balance: bal }, i) => (
                                        <tr key={tx.id} className={`border-b border-slate-50 dark:border-slate-800 ${i % 2 === 0 ? "" : "bg-slate-50/50 dark:bg-slate-950/50"}`}>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(tx.transaction_date)}</td>
                                            <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{tx.description || "—"}</td>
                                            <td className="px-4 py-3 text-slate-500">
                                                {tx.reference_no || "—"}
                                                {tx.order_id && (
                                                    <button
                                                        type="button"
                                                        onClick={() => nav(`/orders/${tx.order_id}`)}
                                                        className="ml-2 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-primary-600 hover:bg-primary-50 dark:border-slate-700"
                                                        title="Siparişe git"
                                                    >
                                                        <ExternalLink className="h-3 w-3" /> Sipariş
                                                    </button>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right font-bold text-red-600">
                                                {tx.transaction_type === "debt" ? `+ ${formatTL(tx.amount)}` : "—"}
                                            </td>
                                            <td className="px-4 py-3 text-right font-bold text-emerald-600">
                                                {tx.transaction_type === "payment" || tx.transaction_type === "cancel" ? `− ${formatTL(tx.amount)}` : "—"}
                                            </td>
                                            <td className={`px-4 py-3 text-right font-black ${bal > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                                                {formatTL(bal)}
                                            </td>
                                        </tr>
                                    ));
                                })()}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
                                    <td colSpan={3} className="px-4 py-3 text-xs font-black uppercase text-slate-500">Toplam</td>
                                    <td className="px-4 py-3 text-right font-black text-red-700">{formatTL(totalDebt)}</td>
                                    <td className="px-4 py-3 text-right font-black text-emerald-700">{formatTL(totalPaid + totalCancel)}</td>
                                    <td className={`px-4 py-3 text-right font-black ${balance > 0 ? "text-red-700" : "text-emerald-700"}`}>{formatTL(balance)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}