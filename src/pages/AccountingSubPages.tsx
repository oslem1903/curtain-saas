/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, FileText, Plus, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { shareOrDownloadTextFile } from "../utils/nativeShare";
import { logAction } from "../utils/audit";

type IncomeRow = {
    id: string;
    income_date: string | null;
    amount: number | null;
    payment_method: string | null;
    description: string | null;
    source: string | null;
    note?: string | null;
};

type ExpenseRow = {
    id: string;
    expense_date: string | null;
    amount: number | null;
    category: string | null;
    vendor: string | null;
    payment_method: string | null;
    status: string | null;
    note: string | null;
    due_date?: string | null;
    document_no?: string | null;
    is_installment?: boolean | null;
    installment_count?: number | null;
    is_recurring?: boolean | null;
};

type InvoiceTaxRow = {
    id: string;
    date: string | null;
    invoice_no: string | null;
    invoice_type: string | null;
    total_tax_exclusive: number | null;
    total_tax_amount: number | null;
    total_tax_inclusive: number | null;
    status: string | null;
};

type TxRow = {
    id: string;
    tx_date: string | null;
    type: string | null;
    direction: string | null;
    amount: number | null;
    description: string | null;
};

async function resolveCompanyId() {
    return getEffectiveTenantContext().then((ctx) => ctx.company_id).catch(() => null);
}

function formatTL(value: number | null | undefined) {
    return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        maximumFractionDigits: 2,
    }).format(Number(value ?? 0));
}

function formatDate(value?: string | null) {
    if (!value) return "-";
    return new Date(value).toLocaleDateString("tr-TR");
}

// CSV alan\u0131n\u0131 g\u00FCvenli ka\u00E7\u0131\u015Flar: ayra\u00E7 (;), t\u0131rnak veya sat\u0131r sonu i\u00E7eriyorsa t\u0131rnakla.
function csvEscape(value: string | number): string {
    const s = String(value ?? "");
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function csvDownload(filename: string, headers: string[], rows: Array<Array<string | number>>) {
    const content = [headers, ...rows].map((row) => row.map(csvEscape).join(";")).join("\r\n");
    await shareOrDownloadTextFile({
        filename,
        mimeType: "text/csv;charset=utf-8;",
        text: `\uFEFF${content}`,
        title: filename,
    });
}

function PageHeader({ title, subtitle, onRefresh }: { title: string; subtitle: string; onRefresh: () => void }) {
    const nav = useNavigate();
    return (
        <div className="mb-5 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
                <button onClick={() => nav(-1)} className="shrink-0 rounded-xl border border-slate-200 p-2 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                    <h1 className="break-words text-xl font-black text-slate-900 dark:text-white sm:text-2xl">{title}</h1>
                    <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
                </div>
            </div>
            <button onClick={onRefresh} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
                <RefreshCw className="h-4 w-4" />
                Yenile
            </button>
        </div>
    );
}

function SummaryCard({ title, value, tone }: { title: string; value: string; tone: "green" | "red" | "blue" | "amber" }) {
    const toneClass = {
        green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20",
        red: "bg-rose-50 text-rose-700 dark:bg-rose-900/20",
        blue: "bg-blue-50 text-blue-700 dark:bg-blue-900/20",
        amber: "bg-amber-50 text-amber-700 dark:bg-amber-900/20",
    }[tone];
    return (
        <div className={`min-w-0 rounded-2xl p-4 ${toneClass}`}>
            <div className="text-xs font-black uppercase opacity-80">{title}</div>
            <div className="mt-2 break-words text-2xl font-black">{value}</div>
        </div>
    );
}

const EXPENSE_CATEGORIES = [
    "Vergi",
    "KDV",
    "SGK",
    "Personel ödemesi",
    "Kira",
    "Tedarik",
    "Yakıt / yol",
    "Nakliye",
    "Elektrik / su / internet",
    "Reklam",
    "Bakım / servis",
    "Diğer",
];

const PERIOD_EXPENSE_CATEGORIES = new Set(["Vergi", "KDV", "SGK", "Personel ödemesi", "Kira"]);

const MONTHS_TR = [
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık",
];

export function IncomePage() {
    const [companyId, setCompanyId] = useState("");
    const [rows, setRows] = useState<IncomeRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");
    const [method, setMethod] = useState("");

    async function loadData() {
        setLoading(true);
        const cid = await resolveCompanyId();
        setCompanyId(cid ?? "");
        if (!cid) {
            setRows([]);
            setLoading(false);
            return;
        }
        const { data } = await supabase
            .from("income")
            .select("id, income_date, amount, payment_method, description, source, note")
            .eq("company_id", cid)
            .order("income_date", { ascending: false });
        setRows((data ?? []) as IncomeRow[]);
        setLoading(false);
    }

    useEffect(() => {
        void loadData();
    }, []);

    async function addIncome() {
        const value = Number(amount);
        if (!companyId || !Number.isFinite(value) || value <= 0) return;
        const nowIso = new Date().toISOString();
        try {
            // Use atomic RPC function for income entry with transaction log
            const { data, error } = await supabase.rpc("record_income_entry", {
                p_company_id: companyId,
                p_income_date: nowIso,
                p_amount: value,
                p_payment_method: method || null,
                p_description: description || "Gelir kaydı",
                p_source: "other",
                p_create_transaction: true,
            });

            if (error) throw error;
            if (!data?.success) throw new Error(data?.error || "Gelir kaydedilemedi.");

            // Log audit trail (fire-and-forget)
            logAction("income_created", "income", data.income_id || "", {
                amount: value,
                payment_method: method,
                source: "other",
                timestamp: new Date().toISOString()
            }).catch(err => console.error("Audit log failed:", err));

            setAmount("");
            setDescription("");
            setMethod("");
            await loadData();
        } catch (e: any) {
            alert(e?.message ?? "Gelir kaydedilemedi.");
        }
    }

    const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0), [rows]);

    return (
        <div className="mx-auto max-w-7xl space-y-5 pb-24">
            <PageHeader title="Gelirler" subtitle="Tahsilatlar, diğer gelirler ve kasa girişleri." onRefresh={loadData} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <SummaryCard title="Toplam Gelir" value={formatTL(total)} tone="green" />
                <SummaryCard title="Kayıt Sayısı" value={String(rows.length)} tone="blue" />
                <button
                    onClick={() => csvDownload("gelirler.csv", ["Tarih", "Tutar", "Yöntem", "Açıklama"], rows.map((r) => [formatDate(r.income_date), Number(r.amount ?? 0).toFixed(2), r.payment_method || "", r.description || ""]))}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 p-4 font-bold hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                >
                    <Download className="h-5 w-5" />
                    Excel / CSV
                </button>
            </div>
            <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-[160px,1fr,180px,auto]">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-3 dark:border-slate-800" placeholder="Tutar" type="number" />
                <input value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-3 dark:border-slate-800" placeholder="Açıklama" />
                <input value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-3 dark:border-slate-800" placeholder="Nakit / Kart / EFT" />
                <button onClick={addIncome} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-black text-white">
                    <Plus className="h-4 w-4" />
                    Gelir Ekle
                </button>
            </div>
            <LedgerList loading={loading} rows={rows.map((r) => ({ id: r.id, date: r.income_date, title: r.description || "Gelir", meta: r.payment_method || r.source || "-", amount: Number(r.amount ?? 0), positive: true }))} />
        </div>
    );
}

export function ExpensesPage() {
    const [companyId, setCompanyId] = useState("");
    const [rows, setRows] = useState<ExpenseRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [amount, setAmount] = useState("");
    const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [dueDate, setDueDate] = useState("");
    const [documentNo, setDocumentNo] = useState("");
    const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
    const [periodMonth, setPeriodMonth] = useState(MONTHS_TR[new Date().getMonth()]);
    const [vendor, setVendor] = useState("");
    const [method, setMethod] = useState("");
    const [status, setStatus] = useState("paid");
    const [isInstallment, setIsInstallment] = useState(false);
    const [installmentCount, setInstallmentCount] = useState("1");
    const [isRecurring, setIsRecurring] = useState(false);
    const [description, setDescription] = useState("");
    const needsPeriod = PERIOD_EXPENSE_CATEGORIES.has(category);

    async function loadData() {
        setLoading(true);
        const cid = await resolveCompanyId();
        setCompanyId(cid ?? "");
        if (!cid) {
            setRows([]);
            setLoading(false);
            return;
        }
        let res: any = await supabase
            .from("expenses")
            .select("id, expense_date, amount, category, vendor, payment_method, status, note, due_date, document_no, is_installment, installment_count, is_recurring")
            .eq("company_id", cid)
            .order("expense_date", { ascending: false });
        if (res.error) {
            res = await supabase
                .from("expenses")
                .select("id, expense_date, amount, category, vendor, payment_method, status, note")
                .eq("company_id", cid)
                .order("expense_date", { ascending: false });
        }
        setRows((res.data ?? []) as ExpenseRow[]);
        setLoading(false);
    }

    useEffect(() => {
        void loadData();
    }, []);

    async function addExpense() {
        const value = Number(amount);
        if (!companyId || !Number.isFinite(value) || value <= 0) return;
        const expenseDateIso = expenseDate ? new Date(`${expenseDate}T12:00:00`).toISOString() : new Date().toISOString();
        try {
            const noteText = [
                needsPeriod ? `İlgili ay: ${periodMonth}` : null,
                documentNo ? `Belge/Fatura No: ${documentNo}` : null,
                isInstallment ? `Taksit: ${installmentCount || "1"} taksit` : null,
                isRecurring ? "Tekrarlayan ödeme" : null,
                description || null,
            ].filter(Boolean).join("\n") || null;

            // Use atomic RPC function for expense entry with optional transaction log
            const { data, error } = await supabase.rpc("record_expense_entry", {
                p_company_id: companyId,
                p_expense_date: expenseDateIso,
                p_amount: value,
                p_category: category || null,
                p_description: [category || vendor || "Gider kaydı", needsPeriod ? periodMonth : null].filter(Boolean).join(" - "),
                p_note: noteText,
                p_payment_method: method || null,
                p_status: status,
                p_create_transaction: true,
            });

            if (error) throw error;
            if (!data?.success) throw new Error(data?.error || "Gider kaydedilemedi.");

            // Log audit trail (fire-and-forget)
            logAction("expense_created", "expense", data.expense_id || "", {
                amount: value,
                category,
                payment_method: method,
                status,
                timestamp: new Date().toISOString()
            }).catch(err => console.error("Audit log failed:", err));

            setAmount("");
            setExpenseDate(new Date().toISOString().slice(0, 10));
            setDueDate("");
            setDocumentNo("");
            setCategory(EXPENSE_CATEGORIES[0]);
            setPeriodMonth(MONTHS_TR[new Date().getMonth()]);
            setVendor("");
            setMethod("");
            setStatus("paid");
            setIsInstallment(false);
            setInstallmentCount("1");
            setIsRecurring(false);
            setDescription("");
            await loadData();
        } catch (e: any) {
            alert(e?.message ?? "Gider kaydedilemedi.");
        }
    }

    const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0), [rows]);
    const pending = useMemo(() => rows.filter((x) => (x.status || "paid") !== "paid").reduce((sum, row) => sum + Number(row.amount ?? 0), 0), [rows]);

    return (
        <div className="mx-auto max-w-7xl space-y-5 pb-24">
            <PageHeader title="Giderler" subtitle="Vergi, SGK, kira, personel, tedarik ve diğer kasa çıkışları." onRefresh={loadData} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <SummaryCard title="Toplam Gider" value={formatTL(total)} tone="red" />
                <SummaryCard title="Bekleyen" value={formatTL(pending)} tone="amber" />
                <button
                    onClick={() => csvDownload("giderler.csv", ["Tarih", "Tutar", "Kategori", "Firma", "Durum"], rows.map((r) => [formatDate(r.expense_date), Number(r.amount ?? 0).toFixed(2), r.category || "", r.vendor || "", r.status || ""]))}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 p-4 font-bold hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                >
                    <Download className="h-5 w-5" />
                    Excel / CSV
                </button>
            </div>
            <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-[140px,1fr,1fr,160px,auto]">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-3 dark:border-slate-800" placeholder="Tutar" type="number" />
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-3 dark:border-slate-800">
                    {EXPENSE_CATEGORIES.map((item) => (
                        <option key={item} value={item}>{item}</option>
                    ))}
                </select>
                <input value={vendor} onChange={(e) => setVendor(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-3 dark:border-slate-800" placeholder="Firma / kişi" />
                <input value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-3 dark:border-slate-800" placeholder="Yöntem" />
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-3 dark:border-slate-800">
                    <option value="paid">Paid / Ödendi</option>
                    <option value="unpaid">Unpaid / Ödenmedi</option>
                </select>
                <input value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-3 dark:border-slate-800" type="date" title="Ödeme tarihi" />
                <input value={documentNo} onChange={(e) => setDocumentNo(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-3 dark:border-slate-800" placeholder="Belge / Fatura No" />
                <input value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl border border-slate-200 bg-transparent px-3 py-3 dark:border-slate-800" placeholder="Açıklama" />
                <button onClick={addExpense} className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 font-black text-white">
                    <Plus className="h-4 w-4" />
                    Gider Ekle
                </button>
                {needsPeriod ? (
                    <div className="md:col-span-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/10">
                        <div className="mb-2 text-xs font-black uppercase text-amber-800 dark:text-amber-200">İlgili ay</div>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
                            {MONTHS_TR.map((month) => (
                                <button
                                    key={month}
                                    type="button"
                                    onClick={() => setPeriodMonth(month)}
                                    className={`rounded-xl px-3 py-2 text-sm font-bold transition ${periodMonth === month ? "bg-amber-600 text-white shadow-sm" : "bg-white text-amber-800 hover:bg-amber-100 dark:bg-slate-900 dark:text-amber-100"}`}
                                >
                                    {month}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}
                <div className="md:col-span-5 flex flex-wrap gap-3 rounded-2xl border border-slate-200 p-3 text-sm dark:border-slate-800">
                    <label className="inline-flex items-center gap-2 font-semibold">
                        <input type="checkbox" checked={isInstallment} onChange={(e) => setIsInstallment(e.target.checked)} />
                        Taksitli
                    </label>
                    {isInstallment ? (
                        <input value={installmentCount} onChange={(e) => setInstallmentCount(e.target.value)} className="w-24 rounded-xl border border-slate-200 bg-transparent px-3 py-2 dark:border-slate-800" type="number" min={1} />
                    ) : null}
                    <label className="inline-flex items-center gap-2 font-semibold">
                        <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
                        Tekrarlayan ödeme
                    </label>
                </div>
            </div>
            <LedgerList loading={loading} rows={rows.map((r) => ({ id: r.id, date: r.expense_date, title: r.category || r.vendor || "Gider", meta: `${r.note ? `${r.note} / ` : ""}${r.payment_method || "-"} / ${r.status || "paid"}`, amount: Number(r.amount ?? 0), positive: false }))} />
        </div>
    );
}

export function TaxPage() {
    const [rows, setRows] = useState<InvoiceTaxRow[]>([]);
    const [loading, setLoading] = useState(true);

    async function loadData() {
        setLoading(true);
        const cid = await resolveCompanyId();
        if (!cid) {
            setRows([]);
            setLoading(false);
            return;
        }
        const { data } = await supabase
            .from("invoices")
            .select("id, date, invoice_no, invoice_type, total_tax_exclusive, total_tax_amount, total_tax_inclusive, status")
            .eq("company_id", cid)
            .order("date", { ascending: false });
        setRows((data ?? []) as InvoiceTaxRow[]);
        setLoading(false);
    }

    useEffect(() => {
        void loadData();
    }, []);

    const validRows = rows.filter((x) => !["draft", "cancelled"].includes(String(x.status || "")));
    const taxTotal = validRows.reduce((sum, row) => sum + Number(row.total_tax_amount ?? 0), 0);
    const invoiceTotal = validRows.reduce((sum, row) => sum + Number(row.total_tax_inclusive ?? 0), 0);

    return (
        <div className="mx-auto max-w-7xl space-y-5 pb-24">
            <PageHeader title="KDV / Vergi Takibi" subtitle="Kesilen faturalar üzerinden KDV ve vergi dönem takibi." onRefresh={loadData} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <SummaryCard title="Kesilen Fatura" value={formatTL(invoiceTotal)} tone="blue" />
                <SummaryCard title="KDV Toplamı" value={formatTL(taxTotal)} tone="amber" />
                <SummaryCard title="Vergi Kayıt Sayısı" value={String(validRows.length)} tone="green" />
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
                <div className="font-black">Yaklaşan dönem hatırlatmaları</div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                    <div>KDV: Her ayın son beyan döneminde kontrol edilir.</div>
                    <div>SGK: Personel maaş kayıtları ile takip edilir.</div>
                    <div>Stopaj / Geçici vergi: Raporlar sayfasından dışa aktarılır.</div>
                </div>
            </div>
            <TaxList loading={loading} rows={validRows} />
        </div>
    );
}

export function ReportsPage() {
    const [rows, setRows] = useState<TxRow[]>([]);
    const [loading, setLoading] = useState(true);

    async function loadData() {
        setLoading(true);
        const cid = await resolveCompanyId();
        if (!cid) {
            setRows([]);
            setLoading(false);
            return;
        }
        const { data } = await supabase
            .from("transactions")
            .select("id, tx_date, type, direction, amount, description")
            .eq("company_id", cid)
            .order("tx_date", { ascending: false });
        setRows((data ?? []) as TxRow[]);
        setLoading(false);
    }

    useEffect(() => {
        void loadData();
    }, []);

    const income = rows.filter((x) => x.direction === "in").reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const expense = rows.filter((x) => x.direction === "out").reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

    return (
        <div className="mx-auto max-w-7xl space-y-5 pb-24">
            <PageHeader title="Raporlar" subtitle="Gelir, gider, kasa ve dönemsel finans raporları." onRefresh={loadData} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <SummaryCard title="Gelir" value={formatTL(income)} tone="green" />
                <SummaryCard title="Gider" value={formatTL(expense)} tone="red" />
                <SummaryCard title="Net" value={formatTL(income - expense)} tone={income - expense >= 0 ? "blue" : "amber"} />
                <button
                    onClick={() => csvDownload("finansal-rapor.csv", ["Tarih", "Tip", "Yön", "Tutar", "Açıklama"], rows.map((r) => [formatDate(r.tx_date), r.type || "", r.direction || "", Number(r.amount ?? 0).toFixed(2), r.description || ""]))}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 p-4 font-bold hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                >
                    <FileText className="h-5 w-5" />
                    Rapor İndir
                </button>
            </div>
            <LedgerList loading={loading} rows={rows.map((r) => ({ id: r.id, date: r.tx_date, title: r.description || r.type || "İşlem", meta: r.type || "-", amount: Number(r.amount ?? 0), positive: r.direction === "in" }))} />
        </div>
    );
}

function LedgerList({ loading, rows }: { loading: boolean; rows: Array<{ id: string; date: string | null; title: string; meta: string; amount: number; positive: boolean }> }) {
    if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">Yükleniyor...</div>;
    if (rows.length === 0) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">Kayıt bulunamadı.</div>;

    return (
        <div className="space-y-3">
            {rows.map((row) => (
                <div key={row.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <div className="break-words font-black text-slate-900 dark:text-white">{row.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatDate(row.date)} / {row.meta}</div>
                    </div>
                    <div className={`text-lg font-black ${row.positive ? "text-emerald-600" : "text-rose-600"}`}>
                        {row.positive ? "+" : "-"} {formatTL(row.amount)}
                    </div>
                </div>
            ))}
        </div>
    );
}

function TaxList({ loading, rows }: { loading: boolean; rows: InvoiceTaxRow[] }) {
    if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">Yükleniyor...</div>;
    if (rows.length === 0) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">Vergi raporu için fatura bulunamadı.</div>;

    return (
        <div className="space-y-3">
            {rows.map((row) => (
                <div key={row.id} className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-[1fr,150px,150px,150px] sm:items-center">
                    <div className="min-w-0">
                        <div className="break-words font-black text-slate-900 dark:text-white">{row.invoice_no || "Fatura"}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatDate(row.date)} / {row.invoice_type || "sales"}</div>
                    </div>
                    <div>
                        <div className="text-xs text-slate-500">Matrah</div>
                        <div className="font-bold">{formatTL(row.total_tax_exclusive)}</div>
                    </div>
                    <div>
                        <div className="text-xs text-slate-500">KDV</div>
                        <div className="font-bold text-amber-700">{formatTL(row.total_tax_amount)}</div>
                    </div>
                    <div>
                        <div className="text-xs text-slate-500">Toplam</div>
                        <div className="font-bold text-blue-700">{formatTL(row.total_tax_inclusive)}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}
