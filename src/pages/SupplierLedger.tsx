import { useEffect, useMemo, useState } from "react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";

type SupplierRow = {
    id: string;
    name: string | null;
};

type ExpenseLedgerRow = {
    id: string;
    expense_date: string | null;
    amount: number | null;
    category: string | null;
    note: string | null;
    status: string | null;
    vendor: string | null;
};

type SupplierPaymentRow = {
    id: string;
    payment_date: string | null;
    amount: number | null;
    payment_method: string | null;
    note: string | null;
};

type LedgerRow = {
    id: string;
    row_type: "debt" | "payment";
    date: string | null;
    description: string;
    debt: number;
    payment: number;
};

function formatTL(n: number) {
    return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        maximumFractionDigits: 2,
    }).format(Number.isFinite(n) ? n : 0);
}

function formatDateTR(iso?: string | null) {
    if (!iso) return "-";
    try {
        return new Date(iso).toLocaleString("tr-TR");
    } catch {
        return iso;
    }
}

async function resolveCompanyId(): Promise<string | null> {
    const demoCompanyId = localStorage.getItem("demo_company_id");
    if (demoCompanyId) return demoCompanyId;

    const keys = ["company_id", "current_company_id", "active_company_id", "companyId"];

    for (const k of keys) {
        const v = localStorage.getItem(k);
        if (v && v.length > 10) return v;
    }

    return getEffectiveTenantContext().then((ctx) => ctx.company_id).catch(() => null);
}

export default function SupplierLedger() {
    const [companyId, setCompanyId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
    const [selectedSupplierId, setSelectedSupplierId] = useState("");

    const [expenseRows, setExpenseRows] = useState<ExpenseLedgerRow[]>([]);
    const [paymentRows, setPaymentRows] = useState<SupplierPaymentRow[]>([]);

    const [showQuickPaymentModal, setShowQuickPaymentModal] = useState(false);
    const [showQuickExpenseModal, setShowQuickExpenseModal] = useState(false);
    const [saving, setSaving] = useState(false);

    const [quickPaymentAmount, setQuickPaymentAmount] = useState("");
    const [quickPaymentMethod, setQuickPaymentMethod] = useState("");
    const [quickPaymentNote, setQuickPaymentNote] = useState("");

    const [quickExpenseAmount, setQuickExpenseAmount] = useState("");
    const [quickExpenseCategory, setQuickExpenseCategory] = useState("");
    const [quickExpenseNote, setQuickExpenseNote] = useState("");
    const [quickExpenseStatus, setQuickExpenseStatus] = useState("unpaid");

    async function loadInitial() {
        setLoading(true);
        setErr(null);

        const cid = await resolveCompanyId();
        setCompanyId(cid);

        if (!cid) {
            setErr("Şirket bulunamadı.");
            setLoading(false);
            return;
        }

        const sup = await supabase
            .from("suppliers")
            .select("id, name")
            .eq("company_id", cid)
            .order("name", { ascending: true });

        if (sup.error) {
            console.error("suppliers fetch error:", sup.error);
            setErr("Tedarikçiler okunamadı.");
            setSuppliers([]);
            setLoading(false);
            return;
        }

        const supplierList = (sup.data ?? []) as SupplierRow[];
        setSuppliers(supplierList);

        if (supplierList.length > 0) {
            setSelectedSupplierId((prev) => prev || supplierList[0].id);
        }

        setLoading(false);
    }

    async function loadLedger() {
        if (!companyId || !selectedSupplierId) {
            setExpenseRows([]);
            setPaymentRows([]);
            return;
        }

        setLoading(true);
        setErr(null);

        const exp = await supabase
            .from("expenses")
            .select("id, expense_date, amount, category, note, status, vendor")
            .eq("company_id", companyId)
            .eq("supplier_id", selectedSupplierId)
            .order("expense_date", { ascending: false });

        const pay = await supabase
            .from("supplier_payments")
            .select("id, payment_date, amount, payment_method, note")
            .eq("company_id", companyId)
            .eq("supplier_id", selectedSupplierId)
            .order("payment_date", { ascending: false });

        if (exp.error) {
            console.error("expenses ledger fetch error:", exp.error);
            setErr("Tedarikçi giderleri okunamadı.");
            setExpenseRows([]);
        } else {
            setExpenseRows((exp.data ?? []) as ExpenseLedgerRow[]);
        }

        if (pay.error) {
            console.error("supplier payments ledger fetch error:", pay.error);
            setErr((prev) => prev ?? "Tedarikçi ödemeleri okunamadı.");
            setPaymentRows([]);
        } else {
            setPaymentRows((pay.data ?? []) as SupplierPaymentRow[]);
        }

        setLoading(false);
    }

    async function saveQuickSupplierPayment() {
        if (!companyId || !selectedSupplierId) return;

        if (!quickPaymentAmount.trim()) {
            alert("Tutar gir.");
            return;
        }

        try {
            setSaving(true);

            const { error } = await supabase.from("supplier_payments").insert({
                company_id: companyId,
                supplier_id: selectedSupplierId,
                payment_date: new Date().toISOString(),
                amount: Number(quickPaymentAmount),
                payment_method: quickPaymentMethod || null,
                note: quickPaymentNote || null,
            });

            if (error) throw error;

            setQuickPaymentAmount("");
            setQuickPaymentMethod("");
            setQuickPaymentNote("");
            setShowQuickPaymentModal(false);

            await loadLedger();
        } catch (e: any) {
            alert(e?.message ?? "Tedarikçi ödemesi kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    }

    async function saveQuickSupplierExpense() {
        if (!companyId || !selectedSupplierId) return;

        if (!quickExpenseAmount.trim()) {
            alert("Tutar gir.");
            return;
        }

        try {
            setSaving(true);

            const { error } = await supabase.from("expenses").insert({
                company_id: companyId,
                supplier_id: selectedSupplierId,
                expense_date: new Date().toISOString(),
                amount: Number(quickExpenseAmount),
                category: quickExpenseCategory || null,
                note: quickExpenseNote || null,
                status: quickExpenseStatus || "unpaid",
                vendor: selectedSupplierName || null,
            });

            if (error) throw error;

            setQuickExpenseAmount("");
            setQuickExpenseCategory("");
            setQuickExpenseNote("");
            setQuickExpenseStatus("unpaid");
            setShowQuickExpenseModal(false);

            await loadLedger();
        } catch (e: any) {
            alert(e?.message ?? "Tedarikçi gideri kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    }

    useEffect(() => {
        loadInitial();
    }, []);

    useEffect(() => {
        if (companyId && selectedSupplierId) {
            loadLedger();
        }
        // `loadLedger` is intentionally excluded to prevent unnecessary reruns.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyId, selectedSupplierId]);

    const selectedSupplierName = useMemo(() => {
        return suppliers.find((s) => s.id === selectedSupplierId)?.name || "Tedarikçi";
    }, [suppliers, selectedSupplierId]);

    const totalDebt = useMemo(() => {
        return expenseRows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    }, [expenseRows]);

    const totalPayment = useMemo(() => {
        return paymentRows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    }, [paymentRows]);

    const remaining = useMemo(() => {
        return Math.max(totalDebt - totalPayment, 0);
    }, [totalDebt, totalPayment]);

    const lastPaymentDate = useMemo(() => {
        if (paymentRows.length === 0) return null;

        const sorted = [...paymentRows].sort((a, b) => {
            const da = a.payment_date ? new Date(a.payment_date).getTime() : 0;
            const db = b.payment_date ? new Date(b.payment_date).getTime() : 0;
            return db - da;
        });

        return sorted[0]?.payment_date ?? null;
    }, [paymentRows]);

    const totalMovementCount = useMemo(() => {
        return expenseRows.length + paymentRows.length;
    }, [expenseRows, paymentRows]);

    const ledgerRows = useMemo<LedgerRow[]>(() => {
        const debts: LedgerRow[] = expenseRows.map((r) => ({
            id: `debt-${r.id}`,
            row_type: "debt",
            date: r.expense_date,
            description: r.category || r.vendor || r.note || "Borç kaydı",
            debt: Number(r.amount ?? 0),
            payment: 0,
        }));

        const payments: LedgerRow[] = paymentRows.map((r) => ({
            id: `payment-${r.id}`,
            row_type: "payment",
            date: r.payment_date,
            description: r.payment_method
                ? `${r.payment_method}${r.note ? ` - ${r.note}` : ""}`
                : r.note || "Ödeme",
            debt: 0,
            payment: Number(r.amount ?? 0),
        }));

        return [...debts, ...payments].sort((a, b) => {
            const da = a.date ? new Date(a.date).getTime() : 0;
            const db = b.date ? new Date(b.date).getTime() : 0;
            return db - da;
        });
    }, [expenseRows, paymentRows]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                        Tedarikçi Cari Hesap
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                        Tedarikçi bazlı borç ve ödeme hareketlerini görün.
                    </p>
                    {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
                </div>

                <div className="w-full lg:w-80">
                    <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">
                        Tedarikçi Seç
                    </label>
                    <select
                        value={selectedSupplierId}
                        onChange={(e) => setSelectedSupplierId(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900"
                    >
                        {suppliers.length === 0 ? (
                            <option value="">Tedarikçi yok</option>
                        ) : (
                            suppliers.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name || "İsimsiz Tedarikçi"}
                                </option>
                            ))
                        )}
                    </select>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
                    <div>
                        <div className="text-sm text-slate-500">Tedarikçi</div>
                        <h2 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                            {selectedSupplierName}
                        </h2>

                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                                <div className="text-xs text-slate-500">Toplam Borç</div>
                                <div className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                                    {formatTL(totalDebt)}
                                </div>
                            </div>

                            <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30">
                                <div className="text-xs text-slate-500">Toplam Ödeme</div>
                                <div className="mt-2 text-lg font-bold text-green-600">
                                    {formatTL(totalPayment)}
                                </div>
                            </div>

                            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30">
                                <div className="text-xs text-slate-500">Kalan Bakiye</div>
                                <div className="mt-2 text-lg font-bold text-red-600">
                                    {formatTL(remaining)}
                                </div>
                            </div>

                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                                <div className="text-xs text-slate-500">Toplam Hareket</div>
                                <div className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                                    {totalMovementCount}
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 text-sm text-slate-500">
                            Son ödeme tarihi:{" "}
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                                {formatDateTR(lastPaymentDate)}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row xl:flex-col gap-3">
                        <button
                            onClick={() => setShowQuickPaymentModal(true)}
                            disabled={!selectedSupplierId}
                            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                        >
                            Hızlı Ödeme Ekle
                        </button>

                        <button
                            onClick={() => setShowQuickExpenseModal(true)}
                            disabled={!selectedSupplierId}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                        >
                            Hızlı Borç / Gider Ekle
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                    <div className="text-sm text-slate-500">Toplam Borç</div>
                    <div className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">
                        {formatTL(totalDebt)}
                    </div>
                    <div className="mt-3 text-xs text-slate-500">{selectedSupplierName}</div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                    <div className="text-sm text-slate-500">Toplam Ödeme</div>
                    <div className="mt-2 text-3xl font-bold text-green-600">
                        {formatTL(totalPayment)}
                    </div>
                    <div className="mt-3 text-xs text-slate-500">kaydedilen supplier payment</div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                    <div className="text-sm text-slate-500">Kalan Bakiye</div>
                    <div className="mt-2 text-3xl font-bold text-red-600">
                        {formatTL(remaining)}
                    </div>
                    <div className="mt-3 text-xs text-slate-500">açık cari bakiye</div>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        Hareketler
                    </h2>
                    <div className="text-sm text-slate-500">{selectedSupplierName}</div>
                </div>

                {loading ? (
                    <p className="text-slate-500">Yükleniyor…</p>
                ) : !selectedSupplierId ? (
                    <p className="text-slate-500">Tedarikçi seçiniz.</p>
                ) : ledgerRows.length === 0 ? (
                    <p className="text-slate-500">Bu tedarikçiye ait hareket yok.</p>
                ) : (
                    <>
                    <div className="space-y-3 md:hidden">
                        {ledgerRows.map((r) => (
                            <div
                                key={r.id}
                                className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/30"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                            {formatDateTR(r.date)}
                                        </div>
                                        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                            {r.description}
                                        </div>
                                    </div>
                                    <span
                                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                                            r.row_type === "debt"
                                                ? "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                                                : "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                                        }`}
                                    >
                                        {r.row_type === "debt" ? "Borc" : "Odeme"}
                                    </span>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <div className="text-[11px] uppercase text-slate-400">Borc</div>
                                        <div className="font-semibold text-red-600">
                                            {r.debt > 0 ? formatTL(r.debt) : "-"}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] uppercase text-slate-400">Odeme</div>
                                        <div className="font-semibold text-green-600">
                                            {r.payment > 0 ? formatTL(r.payment) : "-"}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-semibold text-slate-700 dark:text-slate-300">Toplam Borc</span>
                                <span className="font-bold text-red-600">{formatTL(totalDebt)}</span>
                            </div>
                            <div className="mt-2 flex items-center justify-between text-sm">
                                <span className="font-semibold text-slate-700 dark:text-slate-300">Toplam Odeme</span>
                                <span className="font-bold text-green-600">{formatTL(totalPayment)}</span>
                            </div>
                            <div className="mt-2 flex items-center justify-between text-sm">
                                <span className="font-semibold text-slate-700 dark:text-slate-300">Kalan Bakiye</span>
                                <span className="font-bold text-red-600">{formatTL(remaining)}</span>
                            </div>
                        </div>
                    </div>
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full min-w-[760px] text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 text-left">
                                    <th className="py-3 pr-4">Tarih</th>
                                    <th className="py-3 pr-4">Tür</th>
                                    <th className="py-3 pr-4">Açıklama</th>
                                    <th className="py-3 pr-4 text-right">Borç</th>
                                    <th className="py-3 pr-4 text-right">Ödeme</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ledgerRows.map((r) => (
                                    <tr
                                        key={r.id}
                                        className="border-b border-slate-100 dark:border-slate-800"
                                    >
                                        <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">
                                            {formatDateTR(r.date)}
                                        </td>

                                        <td className="py-3 pr-4">
                                            <span
                                                className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${r.row_type === "debt"
                                                        ? "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                                                        : "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                                                    }`}
                                            >
                                                {r.row_type === "debt" ? "Borç" : "Ödeme"}
                                            </span>
                                        </td>

                                        <td className="py-3 pr-4 text-slate-900 dark:text-white">
                                            {r.description}
                                        </td>

                                        <td className="py-3 pr-4 text-right font-semibold text-red-600">
                                            {r.debt > 0 ? formatTL(r.debt) : "-"}
                                        </td>

                                        <td className="py-3 pr-4 text-right font-semibold text-green-600">
                                            {r.payment > 0 ? formatTL(r.payment) : "-"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>

                            <tfoot>
                                <tr className="border-t-2 border-slate-300 dark:border-slate-700">
                                    <td
                                        colSpan={3}
                                        className="py-4 pr-4 font-bold text-slate-900 dark:text-white"
                                    >
                                        Toplam
                                    </td>
                                    <td className="py-4 pr-4 text-right font-bold text-red-600">
                                        {formatTL(totalDebt)}
                                    </td>
                                    <td className="py-4 pr-4 text-right font-bold text-green-600">
                                        {formatTL(totalPayment)}
                                    </td>
                                </tr>
                                <tr>
                                    <td
                                        colSpan={4}
                                        className="py-2 pr-4 text-right font-semibold text-slate-700 dark:text-slate-300"
                                    >
                                        Kalan Bakiye
                                    </td>
                                    <td className="py-2 pr-4 text-right font-bold text-red-600">
                                        {formatTL(remaining)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    </>
                )}
            </div>

            {showQuickPaymentModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                Hızlı Tedarikçi Ödemesi
                            </h2>
                            <button
                                onClick={() => setShowQuickPaymentModal(false)}
                                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700"
                            >
                                Kapat
                            </button>
                        </div>

                        <div className="text-sm text-slate-500">
                            Tedarikçi: <span className="font-medium">{selectedSupplierName}</span>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Tutar</label>
                            <input
                                value={quickPaymentAmount}
                                onChange={(e) => setQuickPaymentAmount(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="0"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Ödeme Yöntemi</label>
                            <input
                                value={quickPaymentMethod}
                                onChange={(e) => setQuickPaymentMethod(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="Nakit / Havale / Kart"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Not</label>
                            <textarea
                                value={quickPaymentNote}
                                onChange={(e) => setQuickPaymentNote(e.target.value)}
                                rows={3}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="İsteğe bağlı not"
                            />
                        </div>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowQuickPaymentModal(false)}
                                className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                            >
                                Vazgeç
                            </button>
                            <button
                                onClick={saveQuickSupplierPayment}
                                disabled={saving}
                                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-60"
                            >
                                {saving ? "Kaydediliyor..." : "Kaydet"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showQuickExpenseModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                Hızlı Tedarikçi Borcu / Gideri
                            </h2>
                            <button
                                onClick={() => setShowQuickExpenseModal(false)}
                                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700"
                            >
                                Kapat
                            </button>
                        </div>

                        <div className="text-sm text-slate-500">
                            Tedarikçi: <span className="font-medium">{selectedSupplierName}</span>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Tutar</label>
                            <input
                                value={quickExpenseAmount}
                                onChange={(e) => setQuickExpenseAmount(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="0"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Kategori</label>
                            <input
                                value={quickExpenseCategory}
                                onChange={(e) => setQuickExpenseCategory(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="Örn: Kumaş, Mekanizma, Nakliye"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Durum</label>
                            <select
                                value={quickExpenseStatus}
                                onChange={(e) => setQuickExpenseStatus(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                            >
                                <option value="unpaid">Ödenmedi</option>
                                <option value="partial">Kısmi</option>
                                <option value="paid">Ödendi</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Not</label>
                            <textarea
                                value={quickExpenseNote}
                                onChange={(e) => setQuickExpenseNote(e.target.value)}
                                rows={3}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="İsteğe bağlı not"
                            />
                        </div>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowQuickExpenseModal(false)}
                                className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                            >
                                Vazgeç
                            </button>
                            <button
                                onClick={saveQuickSupplierExpense}
                                disabled={saving}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-60"
                            >
                                {saving ? "Kaydediliyor..." : "Kaydet"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
