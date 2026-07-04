import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, FileText, Plus, RefreshCw, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { usePersistedState } from "../hooks/usePersistedState";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { shareOrDownloadTextFile } from "../utils/nativeShare";

type InvoiceRow = {
    id: string;
    order_id: string | null;
    invoice_no: string | null;
    invoice_type: string;
    date: string;
    total_tax_exclusive: number | null;
    total_tax_amount: number | null;
    total_tax_inclusive: number | null;
    paid_amount?: number | null;
    payment_method?: string | null;
    due_date?: string | null;
    status: string;
    customers: { name: string | null } | Array<{ name: string | null }> | null;
    suppliers: { name: string | null } | Array<{ name: string | null }> | null;
};

type InvoiceItemRow = {
    invoice_id: string;
    description: string;
    quantity: number | null;
    unit_price: number | null;
    tax_rate: number | null;
    line_total: number | null;
};

type OrderSyncRow = {
    id: string;
    created_at: string | null;
    status: string | null;
    note: string | null;
    total_amount: number | null;
    paid_amount: number | null;
    remaining_amount: number | null;
    customer_id: string | null;
    customers: { name: string | null } | Array<{ name: string | null }> | null;
    order_items: Array<{
        product_type: string | null;
        width_cm: number | null;
        height_cm: number | null;
        qty: number | null;
        unit_price: number | null;
        line_total: number | null;
    }> | null;
};

type InvoiceView = InvoiceRow & {
    itemSummary: string;
    itemQuantity: number;
    avgUnitPrice: number;
    avgTaxRate: number;
};

async function getCompanyId() {
    return getEffectiveTenantContext().then((ctx) => ctx.company_id).catch(() => null);
}

function formatMoney(value: number | null | undefined) {
    return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        maximumFractionDigits: 2,
    }).format(Number(value ?? 0));
}

function formatDate(value: string) {
    return new Date(value).toLocaleDateString("tr-TR");
}

function invoiceTypeLabel(type: string) {
    if (type === "sales") return "Satis";
    if (type === "purchase") return "Alis";
    if (type === "sales_return") return "Satis Iade";
    if (type === "purchase_return") return "Alis Iade";
    return type;
}

function invoiceStatusLabel(status: string) {
    if (status === "draft") return "Taslak";
    if (status === "sent" || status === "issued") return "Kesildi";
    if (status === "partial") return "Kismi Odendi";
    if (status === "paid") return "Tam Odendi";
    if (status === "overdue") return "Gecikmis";
    if (status === "cancelled") return "Iptal";
    return status;
}

function invoiceStatusClass(status: string) {
    if (status === "paid") return "bg-emerald-100 text-emerald-700";
    if (status === "partial") return "bg-blue-100 text-blue-700";
    if (status === "overdue") return "bg-red-100 text-red-700";
    if (status === "cancelled") return "bg-slate-200 text-slate-600";
    if (status === "draft") return "bg-slate-100 text-slate-700";
    return "bg-amber-100 text-amber-700";
}

function effectiveStatus(invoice: InvoiceRow) {
    if (invoice.status === "sent" || invoice.status === "issued") {
        const due = invoice.due_date ? new Date(invoice.due_date) : null;
        if (due && due < new Date(new Date().toDateString())) return "overdue";
    }
    return invoice.status || "draft";
}

function getPartyName(
    party: { name: string | null } | Array<{ name: string | null }> | null | undefined,
) {
    if (Array.isArray(party)) return party[0]?.name || null;
    return party?.name || null;
}

async function generateInvoiceNo() {
    const year = new Date().getFullYear();
    const { data: lastInvoice } = await supabase
        .from("invoices")
        .select("invoice_no, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!lastInvoice?.invoice_no) {
        return `FAT${year}00001`;
    }

    const numeric = lastInvoice.invoice_no.match(/\d+$/);
    if (!numeric) return `${lastInvoice.invoice_no}1`;

    const next = (parseInt(numeric[0], 10) + 1).toString().padStart(numeric[0].length, "0");
    const prefix = lastInvoice.invoice_no.slice(0, lastInvoice.invoice_no.length - numeric[0].length);
    return `${prefix}${next}`;
}

async function syncOrdersToInvoices(companyId: string) {
    const { data: existingInvoices } = await supabase
        .from("invoices")
        .select("order_id")
        .eq("company_id", companyId)
        .not("order_id", "is", null);

    const existingOrderIds = new Set((existingInvoices ?? []).map((row) => row.order_id).filter(Boolean));

    const { data: orders, error: orderErr } = await supabase
        .from("orders")
        .select("id, created_at, status, note, total_amount, paid_amount, remaining_amount, customer_id, customers(name), order_items(product_type, width_cm, height_cm, qty, unit_price, line_total)")
        .eq("company_id", companyId)
        .not("status", "eq", "draft")
        .not("status", "eq", "cancelled")
        .order("created_at", { ascending: false });

    if (orderErr || !orders) return;

    for (const order of orders as unknown as OrderSyncRow[]) {
        if (!order.id || existingOrderIds.has(order.id)) continue;
        if (!order.total_amount || order.total_amount <= 0) continue;

        const invoiceNo = await generateInvoiceNo();
        const taxRate = 20;
        const divisor = 1 + taxRate / 100;
        const taxExclusive = Number((Number(order.total_amount) / divisor).toFixed(2));
        const taxAmount = Number((Number(order.total_amount) - taxExclusive).toFixed(2));

        // Gercek odeme durumu paid_amount/remaining_amount'tan belirlenir —
        // orders.status'un "paid" degeri (Accounting.tsx::saveIncome tarafindan
        // yazilir) iptal edilen bir tahsilattan sonra bayat kalabilir; bu yuzden
        // status alanina GUVENILMEZ. Tahsilati iptal edilmis bir siparis
        // (remaining_amount tekrar > 0 oldugunda) hicbir zaman "paid" sayilmaz.
        const remaining = order.remaining_amount != null
            ? Number(order.remaining_amount)
            : Math.max(Number(order.total_amount ?? 0) - Number(order.paid_amount ?? 0), 0);

        const { data: invoiceRow, error: invoiceErr } = await supabase
            .from("invoices")
            .insert([
                {
                    company_id: companyId,
                    order_id: order.id,
                    customer_id: order.customer_id,
                    invoice_type: "sales",
                    invoice_no: invoiceNo,
                    date: order.created_at || new Date().toISOString(),
                    total_tax_exclusive: taxExclusive,
                    total_tax_amount: taxAmount,
                    total_tax_inclusive: order.total_amount,
                    status: remaining <= 0 ? "paid" : "sent",
                    notes: order.note || `Siparis faturasi - ${getPartyName(order.customers) || "Musteri"}`,
                },
            ])
            .select("id")
            .single();

        if (invoiceErr || !invoiceRow) continue;

        const items = (order.order_items ?? []).map((item) => ({
            invoice_id: invoiceRow.id,
            company_id: companyId,
            description: `${item.product_type || "Urun"} - ${item.width_cm || 0}x${item.height_cm || 0} cm`,
            quantity: item.qty || 1,
            unit_price: item.unit_price || 0,
            tax_rate: taxRate,
            line_total: item.line_total || 0,
        }));

        if (items.length > 0) {
            await supabase.from("invoice_items").insert(items);
        }
    }
}

export default function Invoices() {
    const nav = useNavigate();
    const [invoices, setInvoices] = useState<InvoiceView[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterType, setFilterType] = usePersistedState("perdepro.invoices.type", "all");
    const [filterStatus, setFilterStatus] = usePersistedState("perdepro.invoices.status", "all");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [overdueOnly, setOverdueOnly] = useState(false);

    useEffect(() => {
        loadInvoices();
    }, []);

    async function loadInvoices() {
        setLoading(true);
        const cid = await getCompanyId();

        if (!cid) {
            setInvoices([]);
            setLoading(false);
            return;
        }

        await syncOrdersToInvoices(cid);

        let invoiceRes: any = await supabase
            .from("invoices")
            .select("id, order_id, invoice_no, invoice_type, date, due_date, paid_amount, payment_method, total_tax_exclusive, total_tax_amount, total_tax_inclusive, status, customers(name), suppliers(name)")
            .eq("company_id", cid)
            .order("date", { ascending: false });

        if (invoiceRes.error) {
            invoiceRes = await supabase
                .from("invoices")
                .select("id, order_id, invoice_no, invoice_type, date, total_tax_exclusive, total_tax_amount, total_tax_inclusive, status, customers(name), suppliers(name)")
                .eq("company_id", cid)
                .order("date", { ascending: false });
        }

        if (invoiceRes.error || !invoiceRes.data) {
            setInvoices([]);
            setLoading(false);
            return;
        }

        const invoiceData = invoiceRes.data as Array<{ id: string }>;
        const invoiceIds = invoiceData.map((invoice: { id: string }) => invoice.id);
        let groupedItems = new Map<string, InvoiceItemRow[]>();

        if (invoiceIds.length > 0) {
            const { data: itemData } = await supabase
                .from("invoice_items")
                .select("invoice_id, description, quantity, unit_price, tax_rate, line_total")
                .in("invoice_id", invoiceIds);

            groupedItems = new Map<string, InvoiceItemRow[]>();
            for (const item of (itemData ?? []) as InvoiceItemRow[]) {
                const current = groupedItems.get(item.invoice_id) ?? [];
                current.push(item);
                groupedItems.set(item.invoice_id, current);
            }
        }

        const nextInvoices = (invoiceData as unknown as InvoiceRow[]).map((invoice) => {
            const items = groupedItems.get(invoice.id) ?? [];
            const qtyTotal = items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
            const avgUnit =
                items.length > 0
                    ? items.reduce((sum, item) => sum + Number(item.unit_price ?? 0), 0) / items.length
                    : 0;
            const avgTax =
                items.length > 0
                    ? items.reduce((sum, item) => sum + Number(item.tax_rate ?? 0), 0) / items.length
                    : 0;

            return {
                ...invoice,
                itemSummary: items.slice(0, 2).map((item) => item.description).join(", ") || "-",
                itemQuantity: qtyTotal,
                avgUnitPrice: avgUnit,
                avgTaxRate: avgTax,
            };
        });

        setInvoices(nextInvoices);
        setLoading(false);
    }

    const filtered = useMemo(() => {
        return invoices.filter((invoice) => {
            const matchesType = filterType === "all" || invoice.invoice_type === filterType;
            const status = effectiveStatus(invoice);
            const matchesStatus = filterStatus === "all" || status === filterStatus || invoice.status === filterStatus;
            const invoiceDate = new Date(invoice.date);
            const matchesStart = !startDate || invoiceDate >= new Date(startDate);
            const matchesEnd = !endDate || invoiceDate <= new Date(`${endDate}T23:59:59`);
            const matchesOverdue = !overdueOnly || status === "overdue";
            const party = getPartyName(invoice.customers) || getPartyName(invoice.suppliers) || "";
            const haystack = `${invoice.invoice_no || ""} ${party} ${invoice.itemSummary}`.toLowerCase();
            return matchesType && matchesStatus && matchesStart && matchesEnd && matchesOverdue && haystack.includes(search.toLowerCase());
        });
    }, [endDate, filterStatus, filterType, invoices, overdueOnly, search, startDate]);

    const summary = useMemo(() => {
        const issued = filtered.filter((x) => !["draft", "cancelled"].includes(x.status));
        const total = issued.reduce((sum, x) => sum + Number(x.total_tax_inclusive ?? 0), 0);
        const tax = issued.reduce((sum, x) => sum + Number(x.total_tax_amount ?? 0), 0);
        const paid = issued.reduce((sum, x) => sum + Number(x.paid_amount ?? (x.status === "paid" ? x.total_tax_inclusive : 0)), 0);
        return {
            total,
            tax,
            paid,
            pending: Math.max(total - paid, 0),
            overdue: filtered.filter((x) => effectiveStatus(x) === "overdue").length,
        };
    }, [filtered]);

    async function handleExportCSV() {
        if (filtered.length === 0) return;

        const headers = [
            "Tarih",
            "Kim/Kime",
            "Tip",
            "Fatura No",
            "Urun",
            "Birim",
            "Birim Fiyat",
            "KDV Orani",
            "KDV Tutari",
            "Toplam Tutar",
            "Durum",
        ];

        const rows = filtered.map((invoice) => [
            formatDate(invoice.date),
            getPartyName(invoice.customers) || getPartyName(invoice.suppliers) || "-",
            invoiceTypeLabel(invoice.invoice_type),
            invoice.invoice_no || "",
            invoice.itemSummary,
            String(invoice.itemQuantity || 0),
            invoice.avgUnitPrice.toFixed(2),
            `${invoice.avgTaxRate.toFixed(0)}%`,
            Number(invoice.total_tax_amount ?? 0).toFixed(2),
            Number(invoice.total_tax_inclusive ?? 0).toFixed(2),
            invoiceStatusLabel(effectiveStatus(invoice)),
        ]);

        const filename = `faturalar_${new Date().toISOString().slice(0, 10)}.csv`;
        const content = [headers, ...rows].map((row) => row.join(";")).join("\n");
        await shareOrDownloadTextFile({
            filename,
            mimeType: "text/csv;charset=utf-8;",
            text: `\uFEFF${content}`,
            title: "Fatura listesi",
        });
    }

    function handleExportPDF() {
        if (filtered.length === 0) return;

        const rows = filtered
            .map(
                (invoice) => `
                    <tr>
                        <td>${formatDate(invoice.date)}</td>
                        <td>${getPartyName(invoice.customers) || getPartyName(invoice.suppliers) || "-"}</td>
                        <td>${invoiceTypeLabel(invoice.invoice_type)}</td>
                        <td>${invoice.invoice_no || "-"}</td>
                        <td>${invoice.itemSummary}</td>
                        <td>${invoice.itemQuantity || 0}</td>
                        <td>${formatMoney(invoice.avgUnitPrice)}</td>
                        <td>%${invoice.avgTaxRate.toFixed(0)}</td>
                        <td>${formatMoney(invoice.total_tax_inclusive)}</td>
                        <td>${invoiceStatusLabel(effectiveStatus(invoice))}</td>
                    </tr>`,
            )
            .join("");

        const printWindow = window.open("", "_blank", "width=1200,height=800");
        if (!printWindow) return;

        printWindow.document.write(`
            <html>
                <head>
                    <title>Fatura Listesi</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
                        h1 { margin-bottom: 16px; }
                        table { width: 100%; border-collapse: collapse; }
                        th, td { border: 1px solid #cbd5e1; padding: 8px; font-size: 12px; text-align: left; vertical-align: top; }
                        th { background: #e2e8f0; }
                    </style>
                </head>
                <body>
                    <h1>Fatura Listesi</h1>
                    <table>
                        <thead>
                            <tr>
                                <th>Tarih</th>
                                <th>Kim/Kime</th>
                                <th>Tip</th>
                                <th>Fatura No</th>
                                <th>Urun</th>
                                <th>Birim</th>
                                <th>Birim Fiyat</th>
                                <th>KDV</th>
                                <th>Toplam</th>
                                <th>Durum</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
    }

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Faturalar</h1>
                    <p className="text-slate-500">Siparislerden otomatik gelen ve elle olusturulan faturalar.</p>
                </div>

                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={loadInvoices}
                        className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition text-sm font-medium"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Listeyi Yenile
                    </button>
                    <button
                        onClick={handleExportCSV}
                        className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition text-sm font-medium"
                    >
                        <Download className="w-4 h-4" />
                        Excel (CSV)
                    </button>
                    <button
                        onClick={handleExportPDF}
                        className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition text-sm font-medium"
                    >
                        <FileText className="w-4 h-4" />
                        PDF Liste
                    </button>
                    <button
                        onClick={() => nav("/invoices/new")}
                        className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl shadow-lg hover:bg-primary-700 transition"
                    >
                        <Plus className="w-5 h-5" />
                        Yeni Fatura
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4 mb-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-bold uppercase text-slate-500">Toplam Kesilen</p>
                    <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{formatMoney(summary.total)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-bold uppercase text-slate-500">KDV Toplami</p>
                    <div className="mt-2 text-2xl font-black text-indigo-600">{formatMoney(summary.tax)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-bold uppercase text-slate-500">Tahsil Edilen</p>
                    <div className="mt-2 text-2xl font-black text-emerald-600">{formatMoney(summary.paid)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-bold uppercase text-slate-500">Bekleyen</p>
                    <div className="mt-2 text-2xl font-black text-amber-600">{formatMoney(summary.pending)}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
                <div className="md:col-span-2 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <input
                        type="text"
                        placeholder="Fatura no, muhatap veya urun ara..."
                        className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <select
                    className="p-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                >
                    <option value="all">Tum Tipler</option>
                    <option value="sales">Satis</option>
                    <option value="purchase">Alis</option>
                    <option value="sales_return">Satis Iade</option>
                    <option value="purchase_return">Alis Iade</option>
                </select>
                <select
                    className="p-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                >
                    <option value="all">Tum Durumlar</option>
                    <option value="draft">Taslak</option>
                    <option value="sent">Kesildi</option>
                    <option value="partial">Kismi Odendi</option>
                    <option value="paid">Tam Odendi</option>
                    <option value="overdue">Gecikmis</option>
                    <option value="cancelled">Iptal</option>
                </select>
                <input
                    type="date"
                    className="p-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                />
                <input
                    type="date"
                    className="p-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                />
                <button
                    onClick={() => setOverdueOnly((prev) => !prev)}
                    className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                        overdueOnly
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
                    }`}
                >
                    <AlertTriangle className="h-4 w-4" />
                    Vadesi Gecen
                </button>
            </div>

            <div className="space-y-4 md:hidden">
                {loading ? (
                    <div className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-400 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        Yukleniyor...
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-400 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        Fatura bulunamadi.
                    </div>
                ) : (
                    filtered.map((invoice) => (
                        <button
                            key={invoice.id}
                            onClick={() => nav(`/invoices/${invoice.id}`)}
                            className="w-full rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/40"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                        {invoice.invoice_no || "Taslak"}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">
                                        {formatDate(invoice.date)} - {invoiceTypeLabel(invoice.invoice_type)}
                                    </div>
                                </div>
                                <span
                                    className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${invoiceStatusClass(effectiveStatus(invoice))}`}
                                >
                                    {invoiceStatusLabel(effectiveStatus(invoice))}
                                </span>
                            </div>

                            <div className="mt-4 space-y-2 text-sm">
                                <div>
                                    <div className="text-[11px] uppercase text-slate-400">Kim / Kime</div>
                                    <div className="font-medium text-slate-800 dark:text-slate-100">
                                        {getPartyName(invoice.customers) || getPartyName(invoice.suppliers) || "-"}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[11px] uppercase text-slate-400">Urun</div>
                                    <div className="text-slate-700 dark:text-slate-200">{invoice.itemSummary}</div>
                                </div>
                                <div className="grid grid-cols-2 gap-3 pt-2">
                                    <div>
                                        <div className="text-[11px] uppercase text-slate-400">Birim / KDV</div>
                                        <div className="font-medium text-slate-800 dark:text-slate-100">
                                            {formatMoney(invoice.avgUnitPrice)}
                                        </div>
                                        <div className="text-xs text-slate-500">KDV %{invoice.avgTaxRate.toFixed(0)}</div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] uppercase text-slate-400">Toplam</div>
                                        <div className="font-bold text-slate-900 dark:text-slate-100">
                                            {formatMoney(invoice.total_tax_inclusive)}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            KDV: {formatMoney(invoice.total_tax_amount)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </button>
                    ))
                )}
            </div>

            <div className="hidden md:block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="px-5 py-4 font-semibold">Tarih / Fatura</th>
                                <th className="px-5 py-4 font-semibold">Kim / Kime</th>
                                <th className="px-5 py-4 font-semibold">Urun Ozeti</th>
                                <th className="px-5 py-4 font-semibold">Birim / KDV</th>
                                <th className="px-5 py-4 font-semibold">Toplam</th>
                                <th className="px-5 py-4 font-semibold">Durum</th>
                                <th className="px-5 py-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                                        Yukleniyor...
                                    </td>
                                </tr>
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                                        Fatura bulunamadi.
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((invoice) => (
                                    <tr key={invoice.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition">
                                        <td className="px-5 py-4">
                                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                                                {invoice.invoice_no || "Taslak"}
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {formatDate(invoice.date)} - {invoiceTypeLabel(invoice.invoice_type)}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 text-sm">
                                            {getPartyName(invoice.customers) || getPartyName(invoice.suppliers) || "-"}
                                        </td>
                                        <td className="px-5 py-4 text-sm">
                                            <div className="font-medium text-slate-800 dark:text-slate-100">{invoice.itemSummary}</div>
                                            <div className="text-xs text-slate-500">{invoice.itemQuantity || 0} birim</div>
                                        </td>
                                        <td className="px-5 py-4 text-sm">
                                            <div>{formatMoney(invoice.avgUnitPrice)}</div>
                                            <div className="text-xs text-slate-500">KDV %{invoice.avgTaxRate.toFixed(0)}</div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="font-bold text-slate-900 dark:text-slate-100">
                                                {formatMoney(invoice.total_tax_inclusive)}
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                Kalan: {formatMoney(Math.max(Number(invoice.total_tax_inclusive ?? 0) - Number(invoice.paid_amount ?? (invoice.status === "paid" ? invoice.total_tax_inclusive : 0)), 0))}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <span
                                                className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${invoiceStatusClass(effectiveStatus(invoice))}`}
                                            >
                                                {invoiceStatusLabel(effectiveStatus(invoice))}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                            <button
                                                onClick={() => nav(`/invoices/${invoice.id}`)}
                                                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-slate-900 transition"
                                            >
                                                Detay
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
