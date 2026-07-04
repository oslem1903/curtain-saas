import { useEffect, useMemo, useState } from "react";
import {
    Download,
    TrendingUp,
    TrendingDown,
    Wallet,
    Receipt,
    Plus,
    BarChart3,
    ArrowLeft,
    RefreshCw,
    LockKeyhole,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";
import { shareOrDownloadTextFile } from "../utils/nativeShare";
import { createFinanceService } from "../services/finance";

const financeService = createFinanceService();


function startOfDay(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function startOfNextDay(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
}

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

type TxRow = {
    id: string;
    tx_date: string | null;
    created_at: string | null;
    type: string | null;
    direction: string | null;
    amount: number | null;
    description: string | null;
};

type PaymentRow = {
    id: string;
    payment_date: string | null;
    amount: number | null;
    method: string | null;
    note: string | null;
    order_id: string | null;
    /** Doluysa bu satır bir tahsilat iptalidir (bkz. customer_cancel_collection RPC) — normal tahsilat gibi gösterilmez. */
    reverses_payment_id?: string | null;
};

type IncomeRow = {
    id: string;
    income_date: string | null;
    amount: number | null;
    payment_method: string | null;
    description: string | null;
    source: string | null;
    order_id: string | null;
};

type SupplierRow = {
    id: string;
    name: string | null;
};

type SupplierPaymentRow = {
    id: string;
    supplier_id: string | null;
    amount: number | null;
    payment_method: string | null;
    note: string | null;
    payment_date: string | null;
};

type SupplierDebtRow = {
    supplier_id: string;
    name: string;
    totalDebt: number;
    totalPaid: number;
    remaining: number;
};

type OrderIncomeRow = {
    id: string;
    customer_id: string | null;
    created_at: string | null;
    status: string | null;
    total_amount: number | null;
    paid_amount: number | null;
    remaining_amount: number | null;
    customer: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null;
};

type CustomerLedgerRow = {
    customer_id: string;
    name: string;
    phone: string | null;
    totalSales: number;
    totalPaid: number;
    balance: number;
};

type EmployeeLedgerRow = {
    employee_id: string;
    name: string;
    salary: number;
    salaryPaid: number;
    advance: number;
    bonus: number;
    netPosition: number;
};

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

const StatCard = ({
    title,
    value,
    icon: Icon,
    subtitle,
    bg,
    onClick,
}: {
    title: string;
    value: string;
    icon: any;
    subtitle: string;
    bg: string;
    onClick?: () => void;
}) => (
    <div
        className={`min-h-[132px] min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5 ${onClick ? "cursor-pointer hover:border-primary-300 hover:shadow-md transition-all" : ""}`}
        onClick={onClick}
    >
        <div className="flex h-full items-start justify-between gap-3">
            <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{title}</p>
                <h3 className="mt-3 break-words text-[clamp(1.65rem,4vw,2.25rem)] font-black leading-tight text-slate-950 dark:text-white">{value}</h3>
                <p className="mt-4 inline-block rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    {subtitle}
                </p>
            </div>
            <div className={`shrink-0 rounded-xl p-2.5 ${bg}`}>
                <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
        </div>
    </div>
);

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

function ProBadge({ onUpgrade }: { onUpgrade: () => void }) {
    return (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800/40 dark:bg-amber-900/20">
            <LockKeyhole className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300">Professional pakette</span>
            <button
                type="button"
                onClick={onUpgrade}
                className="ml-1 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-amber-700"
            >
                Yükselt
            </button>
        </div>
    );
}

export const Accounting = () => {
    const nav = useNavigate();
    const { hasModule } = useAuth();
    const isPro = hasModule("accounting");

    const [companyId, setCompanyId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const [totalIncome, setTotalIncome] = useState(0);
    const [totalExpense, setTotalExpense] = useState(0);
    const [todayCollection, setTodayCollection] = useState(0);
    const [monthOrderPayments, setMonthOrderPayments] = useState(0);
    const [pendingReceivables, setPendingReceivables] = useState(0);
    const [invoiceTotal, setInvoiceTotal] = useState(0);
    const [invoiceVatTotal, setInvoiceVatTotal] = useState(0);
    const [invoicePendingTotal, setInvoicePendingTotal] = useState(0);

    const net = useMemo(() => totalIncome - totalExpense, [totalIncome, totalExpense]);

    const [recent, setRecent] = useState<TxRow[]>([]);
    const [recentPayments, setRecentPayments] = useState<PaymentRow[]>([]);
    const [recentIncome, setRecentIncome] = useState<IncomeRow[]>([]);
    const [recentSupplierPayments, setRecentSupplierPayments] = useState<SupplierPaymentRow[]>([]);

    // --- Tarih Filtreleme Durumu ---
    const [startDate, setStartDate] = useState<string>(() => {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState<string>(() => {
        return new Date().toISOString().split('T')[0];
    });

    const [unpaidExpenseTotal, setUnpaidExpenseTotal] = useState(0);
    const [upcomingObligationTotal, setUpcomingObligationTotal] = useState(0);

    const [supplierDebtTotal, setSupplierDebtTotal] = useState(0);
    const [salarySgkTotal, setSalarySgkTotal] = useState(0);
    const [customerLedgers, setCustomerLedgers] = useState<CustomerLedgerRow[]>([]);
    const [employeeLedgers, setEmployeeLedgers] = useState<EmployeeLedgerRow[]>([]);
    const [customerReceivableTotal, setCustomerReceivableTotal] = useState(0);
    const [employeeAdvanceTotal, setEmployeeAdvanceTotal] = useState(0);
    const [employeeBonusTotal, setEmployeeBonusTotal] = useState(0);

    const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
    const [supplierDebts, setSupplierDebts] = useState<SupplierDebtRow[]>([]);
    const [orderIncomeOptions, setOrderIncomeOptions] = useState<OrderIncomeRow[]>([]);

    const [showIncomeModal, setShowIncomeModal] = useState(false);
    const [showExpenseModal, setShowExpenseModal] = useState(false);
    const [showSupplierPaymentModal, setShowSupplierPaymentModal] = useState(false);
    const [showFinancialDetails, setShowFinancialDetails] = useState(false);
    const [showCollectionModal, setShowCollectionModal] = useState(false);
    const [showMonthPaymentsModal, setShowMonthPaymentsModal] = useState(false);
    const [showExpenseListModal, setShowExpenseListModal] = useState(false);
    const [monthPaymentRows, setMonthPaymentRows] = useState<IncomeRow[]>([]);
    const [supplierPaymentRows, setSupplierPaymentRows] = useState<any[]>([]);
    const [orderDueDates, setOrderDueDates] = useState<Record<string, string>>({});
    const [installerDebtTotal, setInstallerDebtTotal] = useState(0);
    const [collectionDueDate, setCollectionDueDate] = useState("");
    const [supplierPaymentDueDate, setSupplierPaymentDueDate] = useState("");

    // Tahsilat formu state'leri
    const [collectionOrderId, setCollectionOrderId] = useState("");
    const [collectionAmount, setCollectionAmount] = useState("");
    const [collectionMethod, setCollectionMethod] = useState("nakit");
    const [collectionDate, setCollectionDate] = useState(new Date().toISOString().slice(0, 10));
    const [collectionNote, setCollectionNote] = useState("");

    const [saving, setSaving] = useState(false);

    const [incomeAmount, setIncomeAmount] = useState("");
    const [incomeSourceType, setIncomeSourceType] = useState<"order" | "other">("order");
    const [incomeOrderId, setIncomeOrderId] = useState("");
    const [incomeDescription, setIncomeDescription] = useState("");
    const [incomePaymentMethod, setIncomePaymentMethod] = useState("");
    const [incomeNote, setIncomeNote] = useState("");

    const [expenseAmount, setExpenseAmount] = useState("");
    const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [expenseDueDate, setExpenseDueDate] = useState("");
    const [expenseDocumentNo, setExpenseDocumentNo] = useState("");
    const [expenseCategory, setExpenseCategory] = useState(EXPENSE_CATEGORIES[0]);
    const [expensePeriodMonth, setExpensePeriodMonth] = useState(MONTHS_TR[new Date().getMonth()]);
    const [expenseVendor, setExpenseVendor] = useState("");
    const [expenseSupplierId, setExpenseSupplierId] = useState("");
    const [expensePaymentMethod, setExpensePaymentMethod] = useState("");
    const [expenseNote, setExpenseNote] = useState("");
    const [expenseStatus, setExpenseStatus] = useState("paid");
    const [expenseIsInstallment, setExpenseIsInstallment] = useState(false);
    const [expenseInstallmentCount, setExpenseInstallmentCount] = useState("1");
    const [expenseIsRecurring, setExpenseIsRecurring] = useState(false);

    const expenseNeedsPeriod = PERIOD_EXPENSE_CATEGORIES.has(expenseCategory);

    const [supplierPaymentSupplierId, setSupplierPaymentSupplierId] = useState("");
    const [supplierPaymentAmount, setSupplierPaymentAmount] = useState("");
    const [supplierPaymentMethod, setSupplierPaymentMethod] = useState("nakit");
    const [supplierPaymentNote, setSupplierPaymentNote] = useState("");
    const [supplierPaymentDate, setSupplierPaymentDate] = useState(new Date().toISOString().slice(0, 10));

    const selectedSupplierDebt = useMemo(() => {
        if (!supplierPaymentSupplierId) return null;

        const existing = supplierDebts.find((s) => s.supplier_id === supplierPaymentSupplierId);
        if (existing) return existing;

        const supplierName = suppliers.find((s) => s.id === supplierPaymentSupplierId)?.name || "Tedarikçi";

        return {
            supplier_id: supplierPaymentSupplierId,
            name: supplierName,
            totalDebt: 0,
            totalPaid: 0,
            remaining: 0,
        } satisfies SupplierDebtRow;
    }, [supplierDebts, supplierPaymentSupplierId, suppliers]);

    const supplierPaymentPreviewAmount = Number(supplierPaymentAmount || 0);
    const selectedSupplierRemainingAfterPayment = selectedSupplierDebt
        ? selectedSupplierDebt.remaining - (Number.isFinite(supplierPaymentPreviewAmount) ? supplierPaymentPreviewAmount : 0)
        : 0;

    const selectedIncomeOrder = useMemo(() => {
        if (!incomeOrderId) return null;
        return orderIncomeOptions.find((o) => o.id === incomeOrderId) ?? null;
    }, [incomeOrderId, orderIncomeOptions]);

    const selectedIncomeCustomer = useMemo(() => {
        const customer = selectedIncomeOrder?.customer;
        return Array.isArray(customer) ? (customer[0] ?? null) : customer ?? null;
    }, [selectedIncomeOrder]);

    const selectedIncomeOrderTotal = Number(selectedIncomeOrder?.total_amount ?? 0);
    const selectedIncomeOrderPaid = Number(selectedIncomeOrder?.paid_amount ?? 0);
    const selectedIncomeOrderRemaining =
        selectedIncomeOrder?.remaining_amount != null
            ? Number(selectedIncomeOrder.remaining_amount ?? 0)
            : Math.max(selectedIncomeOrderTotal - selectedIncomeOrderPaid, 0);

    async function insertTransaction(payload: {
        company_id: string;
        tx_date?: string;
        type: string;
        direction: "in" | "out";
        amount: number;
        description?: string | null;
    }) {
        const { error } = await supabase.from("transactions").insert({
            company_id: payload.company_id,
            tx_date: payload.tx_date ?? new Date().toISOString(),
            type: payload.type,
            direction: payload.direction,
            amount: payload.amount,
            description: payload.description ?? null,
        });

        if (error) {
            console.error("transaction insert error:", error);
        }
    }

    async function loadData() {
        setLoading(true);
        setErr(null);

        try {
            const cid = await resolveCompanyId();
            setCompanyId(cid);

            if (!cid) {
                setErr("Şirket bulunamadı (company_id).");
                return;
            }

            const fromRange = new Date(startDate).toISOString();
            const toRange = new Date(new Date(endDate).getTime() + 86399000).toISOString(); // Gün sonu
            
            const now = new Date();
            const fromDay = startOfDay(now).toISOString();
            const toDay = startOfNextDay(now).toISOString();


            const inc = await supabase
                .from("income")
                .select("id, amount, income_date, payment_method, description, source, order_id")
                .eq("company_id", cid)
                .order("income_date", { ascending: false });

            if (inc.error) {
                console.error("income fetch error:", inc.error);
                setErr("Gelirler okunamadı.");
            } else {
                const rows = inc.data ?? [];

                const monthIncomeSum = rows
                    .filter((r: any) => {
                        const d = r.income_date ? new Date(r.income_date).toISOString() : null;
                        return d && d >= fromRange && d <= toRange;
                    })
                    .reduce((a: number, r: any) => a + Number(r.amount ?? 0), 0);


                const dayIncomeSum = rows
                    .filter((r: any) => {
                        const d = r.income_date ? new Date(r.income_date).toISOString() : null;
                        return d && d >= fromDay && d < toDay;
                    })
                    .reduce((a: number, r: any) => a + Number(r.amount ?? 0), 0);

                const monthPaymentList = rows.filter((r: any) => {
                    const d = r.income_date ? new Date(r.income_date).toISOString() : null;
                    return (
                        d &&
                        d >= fromRange &&
                        d <= toRange &&
                        String(r.source ?? "").toLowerCase() === "order_payment"
                    );
                });
                const monthOrderPaymentSum = monthPaymentList
                    .reduce((a: number, r: any) => a + Number(r.amount ?? 0), 0);

                setTotalIncome(monthIncomeSum);
                setTodayCollection(dayIncomeSum);
                setMonthOrderPayments(monthOrderPaymentSum);
                setMonthPaymentRows(monthPaymentList as IncomeRow[]);
                setRecentIncome((rows.slice(0, 8) as IncomeRow[]) ?? []);
            }

            let exp: any = await supabase
                .from("expenses")
                .select("amount, expense_date, status, supplier_id, category, note, due_date, order_id")
                .eq("company_id", cid);

            if (exp.error) {
                exp = await supabase
                    .from("expenses")
                    .select("amount, expense_date, status, supplier_id, category, note")
                    .eq("company_id", cid);
            }

            if (exp.error) {
                console.error("expenses fetch error:", exp.error);
                setErr((prev) => prev ?? "Giderler okunamadı.");
            } else {
                const rows = exp.data ?? [];

                const monthExpenseSum = rows
                    .filter((r: any) => {
                        // İptal edilen siparişin gider accrual'ı (status='cancelled') Toplam Gider'e
                        // GİRMEZ — sipariş iptalinde hayalet gider bırakmamak için. (Mevcut veride
                        // gider 'cancelled' olmaz; yalnız iptal edilen sipariş accrual'ını dışlar.)
                        if (String(r.status ?? "").toLowerCase() === "cancelled") return false;
                        // Accrual esas: ödeme anında oluşan tedarikçi nakit gideri (category='Tedarik')
                        // Toplam Gider'e DAHİL EDİLMEZ — aynı maliyet sipariş accrual'ında zaten sayıldı.
                        // Nakit çıkış ayrıca "Tedarikçi Ödemeleri" (supplier_payments) tarafında görünür.
                        if (String(r.category ?? "").trim().toLowerCase() === "tedarik") return false;
                        const d = r.expense_date ? new Date(r.expense_date).toISOString() : null;
                        return d && d >= fromRange && d <= toRange;
                    })
                    .reduce((a: number, r: any) => a + Number(r.amount ?? 0), 0);


                const unpaidSum = rows
                    .filter((r: any) => {
                        // Sipariş tedarikçi accrual'ı (order_id dolu) "Bekleyen Gider"e girmez:
                        // tedarikçi borcunun ödenmiş/kalan durumu cari'de (supplier_transactions)
                        // tutulur; accrual'ın expense.status'u güncellenmediğinden buraya katılmaz.
                        if (r.order_id) return false;
                        return (r.status ?? "paid").toLowerCase() !== "paid";
                    })
                    .reduce((a: number, r: any) => a + Number(r.amount ?? 0), 0);

                const soon = new Date();
                soon.setDate(soon.getDate() + 15);
                const upcomingObligationSum = rows
                    .filter((r: any) => {
                        const status = String(r.status ?? "paid").toLowerCase();
                        const category = String(r.category ?? "").toLowerCase();
                        const isObligation = ["sgk", "vergi", "kdv", "kira", "personel"].some((key) =>
                            category.includes(key),
                        );
                        const due = r.due_date ? new Date(r.due_date) : null;
                        return status !== "paid" && isObligation && (!due || due.getTime() <= soon.getTime());
                    })
                    .reduce((a: number, r: any) => a + Number(r.amount ?? 0), 0);

                const salarySgkSum = rows
                    .filter((r: any) => {
                        const c = String(r.category ?? "").toLowerCase();
                        const n = String(r.note ?? "").toLowerCase();
                        return (
                            c.includes("maaş") ||
                            c.includes("maas") ||
                            c.includes("sgk") ||
                            n.includes("maaş") ||
                            n.includes("maas") ||
                            n.includes("sgk")
                        );
                    })
                    .reduce((a: number, r: any) => a + Number(r.amount ?? 0), 0);

                setTotalExpense(monthExpenseSum);
                setUnpaidExpenseTotal(unpaidSum);
                setUpcomingObligationTotal(upcomingObligationSum);
                setSalarySgkTotal(salarySgkSum);
            }

            let invoiceRes: any = await supabase
                .from("invoices")
                .select("total_tax_inclusive, total_tax_amount, paid_amount, status, date")
                .eq("company_id", cid);

            if (invoiceRes.error) {
                invoiceRes = await supabase
                    .from("invoices")
                    .select("total_tax_inclusive, total_tax_amount, status, date")
                    .eq("company_id", cid);
            }

            if (invoiceRes.error) {
                console.error("invoices fetch error:", invoiceRes.error);
                setInvoiceTotal(0);
                setInvoiceVatTotal(0);
                setInvoicePendingTotal(0);
            } else {
                const rows = (invoiceRes.data ?? []).filter((r: any) => {
                    const status = String(r.status ?? "").toLowerCase();
                    const d = r.date ? new Date(r.date).toISOString() : null;
                    return status !== "draft" && status !== "cancelled" && d && d >= fromRange && d <= toRange;
                });

                const total = rows.reduce((sum: number, r: any) => sum + Number(r.total_tax_inclusive ?? 0), 0);
                const vat = rows.reduce((sum: number, r: any) => sum + Number(r.total_tax_amount ?? 0), 0);
                const pending = rows.reduce((sum: number, r: any) => {
                    const amount = Number(r.total_tax_inclusive ?? 0);
                    const paid = r.paid_amount != null
                        ? Number(r.paid_amount ?? 0)
                        : String(r.status ?? "").toLowerCase() === "paid"
                            ? amount
                            : 0;
                    return sum + Math.max(amount - paid, 0);
                }, 0);

                setInvoiceTotal(total);
                setInvoiceVatTotal(vat);
                setInvoicePendingTotal(pending);
            }

            const tx = await supabase
                .from("transactions")
                .select("id, tx_date, created_at, type, direction, amount, description")
                .eq("company_id", cid)
                .order("tx_date", { ascending: false })
                .order("created_at", { ascending: false })
                .limit(10);

            if (tx.error) {
                console.error("transactions fetch error:", tx.error);
                setRecent([]);
            } else {
                setRecent((tx.data ?? []) as TxRow[]);
            }

            const payRes = await supabase
                .from("payments")
                .select("id, payment_date, amount, method, note, order_id, reverses_payment_id")
                .eq("company_id", cid)
                .order("payment_date", { ascending: false })
                .limit(8);

            let payRows = payRes.data;
            let payErr = payRes.error;

            if (payErr) {
                // reverses_payment_id kolonu henüz yoksa (migration uygulanmadan
                // önce) eski sorguya düş — mevcut davranış korunur.
                const payFb = await supabase
                    .from("payments")
                    .select("id, payment_date, amount, method, note, order_id")
                    .eq("company_id", cid)
                    .order("payment_date", { ascending: false })
                    .limit(8);
                payErr = payFb.error;
                payRows = (payFb.data ?? []).map((r: any) => ({ ...r, reverses_payment_id: null }));
            }

            if (payErr) {
                console.error("payments fetch error:", payErr);
                setRecentPayments([]);
            } else {
                setRecentPayments((payRows ?? []) as PaymentRow[]);
            }

            const sup = await supabase
                .from("suppliers")
                .select("id, name")
                .eq("company_id", cid)
                .order("name", { ascending: true });

            if (sup.error) {
                console.error("suppliers fetch error:", sup.error);
                setSuppliers([]);
            } else {
                setSuppliers((sup.data ?? []) as SupplierRow[]);
            }

            const orderIncomeRes = await supabase
                .from("orders")
                .select(
                    `
                    id,
                    customer_id,
                    created_at,
                    status,
                    total_amount,
                    paid_amount,
                    remaining_amount,
                    customer:customers(name, phone)
                    `
                )
                .eq("company_id", cid)
                .not("status", "eq", "draft")
                .not("status", "eq", "cancelled")
                .order("created_at", { ascending: false })
                .limit(300);

            if (orderIncomeRes.error) {
                console.error("order income options fetch error:", orderIncomeRes.error);
                setOrderIncomeOptions([]);
                setPendingReceivables(0);
                setCustomerLedgers([]);
                setCustomerReceivableTotal(0);
            } else {
                const orderRows = (orderIncomeRes.data ?? []) as OrderIncomeRow[];
                setOrderIncomeOptions(orderRows);
                const receivable = orderRows.reduce((sum, order) => {
                        const total = Number(order.total_amount ?? 0);
                        const paid = Number(order.paid_amount ?? 0);
                        const remaining =
                            order.remaining_amount != null ? Number(order.remaining_amount ?? 0) : Math.max(total - paid, 0);
                        return sum + Math.max(remaining, 0);
                    }, 0);
                setPendingReceivables(receivable);

                const customerMap: Record<string, CustomerLedgerRow> = {};
                orderRows.forEach((order) => {
                    if (!order.customer_id) return;
                    const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;
                    const total = Number(order.total_amount ?? 0);
                    const paid = Number(order.paid_amount ?? 0);
                    const remaining =
                        order.remaining_amount != null ? Number(order.remaining_amount ?? 0) : Math.max(total - paid, 0);
                    if (!customerMap[order.customer_id]) {
                        customerMap[order.customer_id] = {
                            customer_id: order.customer_id,
                            name: customer?.name || "Müşteri",
                            phone: customer?.phone || null,
                            totalSales: 0,
                            totalPaid: 0,
                            balance: 0,
                        };
                    }
                    customerMap[order.customer_id].totalSales += total;
                    customerMap[order.customer_id].totalPaid += paid;
                    customerMap[order.customer_id].balance += Math.max(remaining, 0);
                });

                const nextCustomerLedgers = Object.values(customerMap)
                    .filter((x) => x.totalSales > 0 || x.totalPaid > 0)
                    .sort((a, b) => b.balance - a.balance);
                setCustomerLedgers(nextCustomerLedgers);
                setCustomerReceivableTotal(nextCustomerLedgers.reduce((sum, x) => sum + x.balance, 0));
            }

            // Vade tarihleri — kolon henüz yoksa sessizce geç (migration öncesi uyumluluk)
            try {
                const dueRes = await supabase
                    .from("orders")
                    .select("id, payment_due_date")
                    .eq("company_id", cid)
                    .not("payment_due_date", "is", null);
                if (!dueRes.error) {
                    const map: Record<string, string> = {};
                    (dueRes.data ?? []).forEach((r: any) => {
                        if (r.payment_due_date) map[r.id] = r.payment_due_date;
                    });
                    setOrderDueDates(map);
                }
            } catch {
                // payment_due_date kolonu yok — vade özelliği migration sonrası aktifleşir
            }

            const employeeRes = await supabase
                .from("employees")
                .select("id, full_name, salary_amount, is_active")
                .eq("company_id", cid)
                .order("full_name", { ascending: true });

            const employeeTxRes = await supabase
                .from("employee_transactions")
                .select("employee_id, type, amount, transaction_date")
                .eq("company_id", cid);

            if (employeeRes.error || employeeTxRes.error) {
                if (employeeRes.error) console.error("employees fetch error:", employeeRes.error);
                if (employeeTxRes.error) console.error("employee transactions fetch error:", employeeTxRes.error);
                setEmployeeLedgers([]);
                setEmployeeAdvanceTotal(0);
                setEmployeeBonusTotal(0);
            } else {
                const ledgerMap: Record<string, EmployeeLedgerRow> = {};
                (employeeRes.data ?? []).forEach((emp: any) => {
                    ledgerMap[emp.id] = {
                        employee_id: emp.id,
                        name: emp.full_name || "Personel",
                        salary: Number(emp.salary_amount ?? 0),
                        salaryPaid: 0,
                        advance: 0,
                        bonus: 0,
                        netPosition: 0,
                    };
                });

                (employeeTxRes.data ?? []).forEach((tx: any) => {
                    if (!tx.employee_id || !ledgerMap[tx.employee_id]) return;
                    const amount = Number(tx.amount ?? 0);
                    if (tx.type === "salary") ledgerMap[tx.employee_id].salaryPaid += amount;
                    if (tx.type === "advance") ledgerMap[tx.employee_id].advance += amount;
                    if (tx.type === "bonus") ledgerMap[tx.employee_id].bonus += amount;
                });

                const nextEmployeeLedgers = Object.values(ledgerMap)
                    .map((row) => ({
                        ...row,
                        netPosition: row.salary + row.bonus - row.salaryPaid - row.advance,
                    }))
                    .sort((a, b) => Math.abs(b.netPosition) - Math.abs(a.netPosition));
                setEmployeeLedgers(nextEmployeeLedgers);
                setEmployeeAdvanceTotal(nextEmployeeLedgers.reduce((sum, x) => sum + x.advance, 0));
                setEmployeeBonusTotal(nextEmployeeLedgers.reduce((sum, x) => sum + x.bonus, 0));
            }

            const supplierPaymentsRes = await supabase
                .from("supplier_payments")
                .select("id, supplier_id, amount, payment_method, note, payment_date")
                .eq("company_id", cid)
                .order("payment_date", { ascending: false })
                .limit(8);

            if (supplierPaymentsRes.error) {
                console.error("supplier_payments fetch error:", supplierPaymentsRes.error);
                setRecentSupplierPayments([]);
            } else {
                setRecentSupplierPayments((supplierPaymentsRes.data ?? []) as SupplierPaymentRow[]);
            }

            // Tedarikçi borç/ödeme hesabı: supplier_transactions tablosundan
            // (sipariş borçları debt, ödemeler credit olarak aynı tabloda tutuluyor)
            const supplierTxQuery = await supabase
                .from("supplier_transactions")
                .select("id, supplier_id, transaction_type, amount, transaction_date, description, payment_method")
                .eq("company_id", cid)
                .order("transaction_date", { ascending: false });

            if (supplierTxQuery.error) {
                console.warn("supplier_transactions fetch error:", supplierTxQuery.error.message);
                setSupplierDebts([]);
                setSupplierDebtTotal(0);
                setSupplierPaymentRows([]);
            } else {
                const supplierNameMap: Record<string, string> = {};
                (sup.data ?? []).forEach((s: any) => {
                    supplierNameMap[String(s.id)] = s.name || "Tedarikçi";
                });

                const debtMap: Record<
                    string,
                    { name: string; totalDebt: number; totalPaid: number; totalPaymentReversal: number; supplier_id: string }
                > = {};

                (supplierTxQuery.data ?? []).forEach((r: any) => {
                    if (!r.supplier_id) return;
                    const key = String(r.supplier_id);
                    if (!debtMap[key]) {
                        debtMap[key] = {
                            supplier_id: key,
                            name: supplierNameMap[key] || "Tedarikçi",
                            totalDebt: 0,
                            totalPaid: 0,
                            totalPaymentReversal: 0,
                        };
                    }
                    const amt = Number(r.amount ?? 0);
                    if (r.transaction_type === "debt") debtMap[key].totalDebt += amt;
                    else if (r.transaction_type === "payment" || r.transaction_type === "cancel" || r.transaction_type === "credit") debtMap[key].totalPaid += amt;
                    // 'payment_reversal' = odeme iptali (bkz. supplier_cancel_payment RPC).
                    // Iptal edilen odeme borcu tekrar actigi icin totalPaid'ten degil,
                    // ayri toplanip asagida remaining'e geri eklenir.
                    else if (r.transaction_type === "payment_reversal") debtMap[key].totalPaymentReversal += amt;
                });

                const debtRows: SupplierDebtRow[] = Object.values(debtMap)
                    .map((x) => ({
                        supplier_id: x.supplier_id,
                        name: x.name,
                        totalDebt: x.totalDebt,
                        totalPaid: x.totalPaid,
                        remaining: Math.max(x.totalDebt - x.totalPaid + x.totalPaymentReversal, 0),
                    }))
                    .filter((x) => x.totalDebt > 0 || x.totalPaid > 0)
                    .sort((a, b) => b.remaining - a.remaining);

                setSupplierDebts(debtRows);
                setSupplierDebtTotal(debtRows.reduce((sum, x) => sum + x.remaining, 0));

                // Tedarikçi ödemeleri listesi (Toplam Gider modalı için).
                // BİLİNÇLİ OLARAK 'payment_reversal' DAHİL EDİLMEZ: bu modal "Tedarikçilere
                // yapılan ödemeler" listesidir (satırlar tek renkte/işaretsiz gösterilir,
                // ayrı bir görsel işaretleme yok — bkz. JSX altında). Bir ödeme iptalini
                // aynı listede aynı biçimde göstermek, iptali sanki yeni bir ödemeymiş gibi
                // yanıltıcı gösterirdi. Ayrı işaretleme UI tasarım değişikliği gerektireceği
                // için (bu görevin kapsamı dışında), 'payment_reversal' bu listeden dışarıda
                // bırakılır; bakiye hesapları (supplierDebts/remaining, yukarıda) ise doğru
                // şekilde hesaba katar.
                setSupplierPaymentRows(
                    (supplierTxQuery.data ?? []).filter(
                        (r: any) => r.transaction_type === "payment" || r.transaction_type === "credit"
                    )
                );
            }

            // Montajcı borcu: tamamlanan işlerin hakedişi − montajcıya yapılan ödemeler
            // (tablolar/kolonlar henüz yoksa sessizce geçer)
            try {
                const [jobsRes, instTxRes] = await Promise.all([
                    supabase.from("installation_jobs")
                        .select("installer_fee, status")
                        .eq("company_id", cid)
                        .eq("status", "completed"),
                    supabase.from("installer_transactions")
                        .select("transaction_type, amount")
                        .eq("company_id", cid),
                ]);
                if (!jobsRes.error) {
                    const earned = (jobsRes.data ?? []).reduce((a: number, j: any) => a + Number(j.installer_fee ?? 0), 0);
                    const paidNet = instTxRes.error ? 0 : (instTxRes.data ?? []).reduce(
                        (a: number, t: any) => a + (t.transaction_type === "payment" ? Number(t.amount ?? 0) : -Number(t.amount ?? 0)), 0);
                    setInstallerDebtTotal(Math.max(Math.round((earned - paidNet) * 100) / 100, 0));
                }
            } catch {
                // montajcı cari migration'ı henüz çalıştırılmamış
            }
        } finally {
            setLoading(false);
        }
    }

    async function handleExportReport() {
        if (!companyId) return;
        
        const { data, error } = await supabase
            .from("transactions")
            .select("*")
            .eq("company_id", companyId)
            .order("tx_date", { ascending: false });

        if (error || !data) {
            alert("Rapor verileri alınamadı.");
            return;
        }

        const headers = ["Tarih", "İşlem Türü", "Yön", "Tutar", "Açıklama"];
        const typeMapping: Record<string, string> = {

            "income": "Gelir",
            "expense": "Gider",
            "payment": "Tahsilat",
            "supplier_payment": "Tedarikçi Ödemesi",
            "order_payment": "Sipariş Ödemesi"
        };

        const rows = data.map(it => {
            const label = typeMapping[it.type || ""] || it.type || "-";
            let desc = (it.description || "").replace(/;/g, " ");
            
            // Eğer açıklama "Income" veya "Expense" ise onu da Türkçeleştir
            if (desc.toLowerCase() === "income") desc = "Gelir Kaydı";
            if (desc.toLowerCase() === "expense") desc = "Gider Kaydı";

            return [
                formatDateTR(it.tx_date),
                label,
                it.direction === "in" ? "Gelir" : "Gider",
                it.amount?.toFixed(2) || "0.00",
                desc || "-"
            ];
        });


        const filename = `muhasebe_raporu_${startDate}_ile_${endDate}.csv`;
        const content = [headers, ...rows].map(e => e.join(";")).join("\n");
        await shareOrDownloadTextFile({
            filename,
            mimeType: "text/csv;charset=utf-8;",
            text: `\uFEFF${content}`,
            title: "Muhasebe raporu",
        });
    }


    async function handleExportSummary() {
        if (!companyId) return;

        // Tüm gelirleri ve giderleri çek
        const { data: incomes } = await supabase.from("income").select("*").eq("company_id", companyId);
        const { data: expenses } = await supabase.from("expenses").select("*").eq("company_id", companyId);
        const { data: supPayments } = await supabase.from("supplier_payments").select("*").eq("company_id", companyId);

        const summary: Record<string, any> = {};

        const getMonthKey = (dateStr: string) => {
            const d = new Date(dateStr);
            return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;
        };

        (incomes || []).forEach(it => {
            const key = getMonthKey(it.income_date);
            if (!summary[key]) summary[key] = { income: 0, expense: 0, staff: 0, supplier: 0 };
            summary[key].income += Number(it.amount || 0);
        });

        (expenses || []).forEach(it => {
            // İptal edilen siparişin gider accrual'ı (status='cancelled') sayılmaz — kart
            // (monthExpenseSum) ile birebir aynı: iptal hayalet gider bırakmasın.
            if (String(it.status ?? "").toLowerCase() === "cancelled") return;
            // Accrual esas: tedarikçi nakit ödeme gideri (category='Tedarik') Toplam Gider'e girmez;
            // nakit çıkış zaten ayrı "Tedarikçi Ödemeleri" kolonunda (supplier_payments) gösterilir.
            if (String(it.category ?? "").trim().toLowerCase() === "tedarik") return;
            const key = getMonthKey(it.expense_date);
            if (!summary[key]) summary[key] = { income: 0, expense: 0, staff: 0, supplier: 0 };
            const amount = Number(it.amount || 0);
            summary[key].expense += amount;

            const cat = (it.category || "").toLowerCase();
            const note = (it.note || "").toLowerCase();
            if (cat.includes("maaş") || cat.includes("maas") || cat.includes("sgk") || note.includes("maaş") || note.includes("maas") || note.includes("personel")) {
                summary[key].staff += amount;
            }
        });

        (supPayments || []).forEach(it => {
            const key = getMonthKey(it.payment_date);
            if (!summary[key]) summary[key] = { income: 0, expense: 0, staff: 0, supplier: 0 };
            summary[key].supplier += Number(it.amount || 0);
        });

        const headers = ["Dönem (Ay)", "Toplam Gelir", "Toplam Gider", "Personel Gideri (Maaş/SGK)", "Tedarikçi Ödemeleri", "Net Kar/Zarar"];
        const rows = Object.keys(summary).sort().reverse().map(key => {
            const s = summary[key];
            const net = s.income - s.expense;
            return [
                key,
                s.income.toFixed(2),
                s.expense.toFixed(2),
                s.staff.toFixed(2),
                s.supplier.toFixed(2),
                net.toFixed(2)
            ];
        });

        const filename = `finansal_ozet_${new Date().toISOString().slice(0, 10)}.csv`;
        const content = [headers, ...rows].map(e => e.join(";")).join("\n");
        await shareOrDownloadTextFile({
            filename,
            mimeType: "text/csv;charset=utf-8;",
            text: `\uFEFF${content}`,
            title: "Finansal özet",
        });
    }



    useEffect(() => {
        loadData();
        // `loadData` is intentionally excluded to avoid refiring on each render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startDate, endDate]);

    const setQuickRange = (range: 'today' | 'thisMonth' | 'lastMonth') => {
        const now = new Date();
        if (range === 'today') {
            const day = now.toISOString().split('T')[0];
            setStartDate(day);
            setEndDate(day);
        } else if (range === 'thisMonth') {
            setStartDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]);
            setEndDate(now.toISOString().split('T')[0]);
        } else if (range === 'lastMonth') {
            const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const last = new Date(now.getFullYear(), now.getMonth(), 0);
            setStartDate(first.toISOString().split('T')[0]);
            setEndDate(last.toISOString().split('T')[0]);
        }
    };


    async function saveIncome() {
        if (!companyId) return;
        if (!incomeAmount.trim()) {
            alert("Tutar gir.");
            return;
        }
        if (incomeSourceType === "order" && !selectedIncomeOrder) {
            alert("Siparis sec.");
            return;
        }

        try {
            setSaving(true);

            const amount = Number(incomeAmount);
            if (!Number.isFinite(amount) || amount <= 0) {
                alert("Gecerli bir tutar gir.");
                return;
            }

            const nowIso = new Date().toISOString();
            const customerName = selectedIncomeCustomer?.name || "Musteri";
            const orderDescription =
                incomeSourceType === "order"
                    ? `${customerName} perde satisi`
                    : incomeDescription || "Diğer gelir";
            const source = incomeSourceType === "order" ? "order_payment" : "other";

            if (incomeSourceType === "order" && selectedIncomeOrder) {
                // income + payments + orders.paid_amount/remaining_amount tek atomik
                // RPC cagrisinda yapiliyor (asagidaki "other" dalindaki manuel
                // income.insert'in yerine gecer — iki kez income kaydi olusmasin).
                // orders.status ARTIK BU AKISTAN GUNCELLENMIYOR: bu kolon ayni zamanda
                // is akisi durumu (order.ts::ORDER_STATUS) icin de kullanildigindan,
                // RPC bilincli olarak status'a dokunmuyor (bkz. customerCollectionService.ts
                // basindaki arastirma notu — cakisma riski).
                const result = await financeService.customerCollections.recordCollection({
                    companyId,
                    orderId: selectedIncomeOrder.id,
                    amount,
                    method: incomePaymentMethod,
                    note: incomeNote || incomeDescription || undefined,
                    idempotencyKey: crypto.randomUUID(),
                });
                if (result.status !== "success") {
                    throw result.status === "error" ? result.error : new Error(result.reason);
                }
            } else {
                const { error } = await supabase.from("income").insert({
                    company_id: companyId,
                    income_date: nowIso,
                    amount,
                    payment_method: incomePaymentMethod || null,
                    description: incomeDescription || orderDescription,
                    note: incomeNote || null,
                    source,
                    order_id: null,
                });

                if (error) throw error;
            }

            await insertTransaction({
                company_id: companyId,
                tx_date: nowIso,
                type: source,
                direction: "in",
                amount,
                description: incomeDescription || incomeNote || "Gelir kaydı",
            });

            setIncomeAmount("");
            setIncomeSourceType("order");
            setIncomeOrderId("");
            setIncomeDescription("");
            setIncomePaymentMethod("");
            setIncomeNote("");
            setShowIncomeModal(false);

            await loadData();
        } catch (e: any) {
            const msg = String(e?.message || "");
            alert(msg.includes("customer_record_collection")
                ? "Tahsilat servisi bulunamadı. supabase_customer_collection_finance_rpc.sql dosyasını SQL Editor'da çalıştırın."
                : (e?.message ?? "Gelir kaydedilemedi."));
        } finally {
            setSaving(false);
        }
    }

    async function saveExpense() {
        if (!companyId) return;
        if (!expenseAmount.trim()) {
            alert("Tutar gir.");
            return;
        }

        try {
            setSaving(true);

            const amount = Number(expenseAmount);
            const expenseDateIso = expenseDate ? new Date(`${expenseDate}T12:00:00`).toISOString() : new Date().toISOString();
            const dueDateIso = expenseDueDate ? new Date(`${expenseDueDate}T12:00:00`).toISOString() : null;

            const selectedSupplier =
                suppliers.find((s) => s.id === expenseSupplierId)?.name ?? null;

            const vendorText = selectedSupplier || expenseVendor || null;

            const noteParts = [
                expenseNeedsPeriod ? `İlgili ay: ${expensePeriodMonth}` : null,
                expenseDocumentNo ? `Belge/Fatura No: ${expenseDocumentNo}` : null,
                expenseIsInstallment ? `Taksit: ${expenseInstallmentCount || "1"} taksit` : null,
                expenseIsRecurring ? "Tekrarlayan ödeme" : null,
                expenseNote || null,
            ].filter(Boolean);

            const expensePayload = {
                company_id: companyId,
                expense_date: expenseDateIso,
                amount,
                category: expenseCategory || null,
                vendor: vendorText,
                supplier_id: expenseSupplierId || null,
                payment_method: expensePaymentMethod || null,
                note: noteParts.join("\n") || null,
                status: expenseStatus || "paid",
                due_date: dueDateIso,
                document_no: expenseDocumentNo || null,
                is_installment: expenseIsInstallment,
                installment_count: expenseIsInstallment ? Number(expenseInstallmentCount || 1) : null,
                is_recurring: expenseIsRecurring,
            };

            let { error } = await supabase.from("expenses").insert(expensePayload);

            if (error && /(due_date|document_no|is_installment|installment_count|is_recurring)/i.test(error.message || "")) {
                const legacyPayload: Record<string, unknown> = { ...expensePayload };
                delete legacyPayload.due_date;
                delete legacyPayload.document_no;
                delete legacyPayload.is_installment;
                delete legacyPayload.installment_count;
                delete legacyPayload.is_recurring;
                const retry = await supabase.from("expenses").insert(legacyPayload);
                error = retry.error;
            }

            if (error) throw error;

            if ((expenseStatus || "paid") === "paid") {
                await insertTransaction({
                    company_id: companyId,
                    tx_date: expenseDateIso,
                    type: "expense",
                    direction: "out",
                    amount,
                    description:
                        expenseCategory ||
                        vendorText ||
                        expenseNote ||
                        "Gider kaydı",
                });
            }

            setExpenseAmount("");
            setExpenseDate(new Date().toISOString().slice(0, 10));
            setExpenseDueDate("");
            setExpenseDocumentNo("");
            setExpenseCategory(EXPENSE_CATEGORIES[0]);
            setExpensePeriodMonth(MONTHS_TR[new Date().getMonth()]);
            setExpenseVendor("");
            setExpenseSupplierId("");
            setExpensePaymentMethod("");
            setExpenseNote("");
            setExpenseStatus("paid");
            setExpenseIsInstallment(false);
            setExpenseInstallmentCount("1");
            setExpenseIsRecurring(false);
            setShowExpenseModal(false);

            await loadData();
        } catch (e: any) {
            alert(e?.message ?? "Gider kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    }

    async function saveCollection() {
        if (!companyId) return;
        if (!collectionOrderId) { alert("Sipariş seç."); return; }
        const amount = Number(collectionAmount);
        if (!amount || amount <= 0) { alert("Geçerli bir tutar gir."); return; }

        const order = orderIncomeOptions.find((o) => o.id === collectionOrderId);
        if (!order) { alert("Sipariş bulunamadı."); return; }

        const total = Number(order.total_amount ?? 0);
        const paid = Number(order.paid_amount ?? 0);
        const remaining = order.remaining_amount != null
            ? Number(order.remaining_amount)
            : Math.max(total - paid, 0);

        if (amount > remaining + 0.01) {
            alert(`Bu siparişin kalan borcu ${formatTL(remaining)}. Daha yüksek tahsilat giremezsiniz.`);
            return;
        }

        try {
            setSaving(true);
            const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;
            const customerName = customer?.name || "Müşteri";
            const collDateIso = new Date(collectionDate + "T12:00:00").toISOString();
            const desc = `${customerName} - Sipariş tahsilatı${collectionNote ? ` (${collectionNote})` : ""}`;

            // income + orders.paid_amount/remaining_amount tek atomik RPC cagrisinda
            // yapiliyor (eski 2 ayri yazimin — orders.update + income.insert — yerine
            // gecer). orders.status ARTIK BU AKISTAN GUNCELLENMIYOR (zaten bu akis
            // status'a hic dokunmuyordu, degisiklik yok).
            const result = await financeService.customerCollections.recordCollection({
                companyId,
                orderId: collectionOrderId,
                amount,
                method: collectionMethod,
                date: collDateIso,
                note: desc,
                idempotencyKey: crypto.randomUUID(),
            });
            if (result.status !== "success") {
                throw result.status === "error" ? result.error : new Error(result.reason);
            }

            const newRemaining = result.data.newRemainingAmount;

            // Kalan tutar için vade tarihi (kolon yoksa sessizce geçer) — RPC'nin
            // kapsamında değil, ayrı bir direkt yazım olarak korunuyor.
            if (newRemaining > 0 && collectionDueDate) {
                await supabase.from("orders").update({ payment_due_date: collectionDueDate })
                    .eq("id", collectionOrderId).eq("company_id", companyId);
            } else if (newRemaining <= 0) {
                await supabase.from("orders").update({ payment_due_date: null })
                    .eq("id", collectionOrderId).eq("company_id", companyId).then(() => {}, () => {});
            }

            setCollectionOrderId("");
            setCollectionAmount("");
            setCollectionMethod("nakit");
            setCollectionNote("");
            setCollectionDueDate("");
            setCollectionDate(new Date().toISOString().slice(0, 10));
            await loadData();
        } catch (e: any) {
            const msg = String(e?.message || "");
            alert(msg.includes("customer_record_collection")
                ? "Tahsilat servisi bulunamadı. supabase_customer_collection_finance_rpc.sql dosyasını SQL Editor'da çalıştırın."
                : (e?.message ?? "Tahsilat kaydedilemedi."));
        } finally {
            setSaving(false);
        }
    }

    async function saveSupplierPayment() {
        if (!companyId) return;
        if (!supplierPaymentSupplierId) {
            alert("Tedarikçi seç.");
            return;
        }
        const amount = Number(supplierPaymentAmount);
        if (!amount || amount <= 0) {
            alert("Geçerli bir tutar gir.");
            return;
        }

        // Bakiyeden fazla ödeme kontrolü
        if (selectedSupplierDebt && selectedSupplierDebt.remaining > 0 && amount > selectedSupplierDebt.remaining) {
            alert(`Bu tedarikçinin kalan borcu ${formatTL(selectedSupplierDebt.remaining)}. Daha yüksek ödeme giremezsiniz.`);
            return;
        }

        try {
            setSaving(true);

            const supplierName =
                suppliers.find((s) => s.id === supplierPaymentSupplierId)?.name || "Tedarikçi";
            const payDateIso = new Date(supplierPaymentDate + "T12:00:00").toISOString();

            // 1. supplier_transactions — SupplierDetail ile aynı sistem, "payment" türü
            const txDesc = `${supplierName} ödemesi${supplierPaymentNote ? ` - ${supplierPaymentNote}` : ""}`;
            const { error: txError } = await supabase.from("supplier_transactions").insert({
                company_id: companyId,
                supplier_id: supplierPaymentSupplierId,
                transaction_date: payDateIso,
                transaction_type: "payment",
                amount,
                description: txDesc,
                payment_method: supplierPaymentMethod || null,
            }).select("id").single();
            if (txError) throw txError;

            // Kalan borç için vade tarihi — en yeni açık borç kaydına işle (kolon yoksa sessizce geçer)
            if (supplierPaymentDueDate) {
                try {
                    const { data: lastDebt } = await supabase
                        .from("supplier_transactions")
                        .select("id")
                        .eq("company_id", companyId)
                        .eq("supplier_id", supplierPaymentSupplierId)
                        .eq("transaction_type", "debt")
                        .order("transaction_date", { ascending: false })
                        .limit(1)
                        .maybeSingle();
                    if (lastDebt?.id) {
                        await supabase.from("supplier_transactions")
                            .update({ due_date: supplierPaymentDueDate })
                            .eq("id", lastDebt.id);
                    }
                } catch {
                    // due_date kolonu yok — migration sonrası aktifleşir
                }
            }

            // 2. supplier_payments — muhasebe paneli için yedek kayıt
            await supabase.from("supplier_payments").insert({
                company_id: companyId,
                supplier_id: supplierPaymentSupplierId,
                payment_date: payDateIso,
                amount,
                payment_method: supplierPaymentMethod || null,
                note: supplierPaymentNote || null,
            });

            // 3. Gider kaydı — "Toplam Gider" kartı bu tabloyu okur
            await supabase.from("expenses").insert({
                company_id: companyId,
                supplier_id: supplierPaymentSupplierId,
                amount,
                expense_date: payDateIso,
                category: "Tedarik",
                status: "paid",
                note: txDesc,
            });

            // 4. Genel muhasebe hareket kaydı
            await insertTransaction({
                company_id: companyId,
                tx_date: payDateIso,
                type: "supplier_payment",
                direction: "out",
                amount,
                description: txDesc,
            });

            setSupplierPaymentSupplierId("");
            setSupplierPaymentAmount("");
            setSupplierPaymentMethod("nakit");
            setSupplierPaymentNote("");
            setSupplierPaymentDueDate("");
            setSupplierPaymentDate(new Date().toISOString().slice(0, 10));
            setShowSupplierPaymentModal(false);

            await loadData();
        } catch (e: any) {
            alert(e?.message ?? "Tedarikçi ödemesi kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    }

    const healthLabel = useMemo(() => {
        if (loading) return "Yükleniyor…";
        if (net > 0) return "Sağlıklı";
        if (net === 0) return "Denge";
        return "Dikkat";
    }, [loading, net]);

    const pendingCollectionTotal = Math.max(invoicePendingTotal, pendingReceivables);
    const collectionRate = monthOrderPayments + pendingCollectionTotal > 0
        ? Math.round((monthOrderPayments / (monthOrderPayments + pendingCollectionTotal)) * 100)
        : 100;

    const getSupplierName = (supplierId?: string | null) => {
        if (!supplierId) return "Tedarikçi";
        return suppliers.find((s) => s.id === supplierId)?.name || "Tedarikçi";
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-300">
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => nav(-1)}
                            className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 transition shadow-sm"
                            title="Geri Git"
                        >
                            <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
                        </button>
                        <div className="p-2.5 bg-primary-500 rounded-xl">
                            <Receipt className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-2xl font-bold text-slate-900 dark:text-white leading-none">Muhasebe Paneli</h1>
                                <button
                                    onClick={loadData}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                    title="Yenile"
                                >
                                    <RefreshCw size={18} className={`text-slate-400 ${loading ? "animate-spin" : ""}`} />
                                </button>
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 mt-1.5 text-sm">
                                Finansal performansınızı ve tedarikçi bakiyelerinizi yönetin.
                            </p>
                        </div>
                    </div>
                    {err ? <p className="mt-2 text-sm text-red-600 animate-pulse">⚠️ {err}</p> : null}
                </div>

                {isPro ? (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    {/* Tarih Aralığı Kontrolleri — Pro */}
                    <div className="flex flex-col xs:flex-row items-center gap-2 bg-slate-50 dark:bg-slate-800/50 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-1.5 px-3">
                            <input
                                type="date"
                                className="bg-transparent border-none text-sm font-semibold focus:ring-0 p-1 cursor-pointer"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                            />
                            <span className="text-slate-400 font-medium">→</span>
                            <input
                                type="date"
                                className="bg-transparent border-none text-sm font-semibold focus:ring-0 p-1 cursor-pointer"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                            />
                        </div>
                        <div className="h-4 w-px bg-slate-300 dark:bg-slate-600 hidden xs:block"></div>
                        <div className="flex items-center gap-1 p-0.5">
                            <button onClick={() => setQuickRange('today')} className="px-3 py-1.5 text-xs font-bold rounded-xl hover:bg-white dark:hover:bg-slate-700 transition-all text-slate-600 dark:text-slate-300">Bugün</button>
                            <button onClick={() => setQuickRange('thisMonth')} className="px-3 py-1.5 text-xs font-bold rounded-xl hover:bg-white dark:hover:bg-slate-700 transition-all text-slate-600 dark:text-slate-300">Bu Ay</button>
                            <button onClick={() => setQuickRange('lastMonth')} className="px-3 py-1.5 text-xs font-bold rounded-xl hover:bg-white dark:hover:bg-slate-700 transition-all text-slate-600 dark:text-slate-300">Geçen Ay</button>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleExportSummary}
                            className="flex-1 sm:flex-none px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
                        >
                            <BarChart3 className="w-4 h-4" />
                            Özet
                        </button>
                        <button
                            onClick={handleExportReport}
                            className="flex-1 sm:flex-none px-4 py-2.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all"
                        >
                            <Download className="w-4 h-4" />
                            Detaylı
                        </button>
                    </div>
                </div>
                ) : (
                <ProBadge onUpgrade={() => window.open("https://wa.me/905308427870?text=" + encodeURIComponent("Merhaba, PerdePRO kullanıcısıyım. Muhasebe & Finans modülü için Professional paketine geçmek istiyorum."), "_blank", "noreferrer")} />
                )}
            </div>

            {/* Hızlı İşlem Butonları */}
            <div className="flex flex-wrap items-center gap-3 mt-4">
                <button
                    onClick={() => isPro ? setShowIncomeModal(true) : undefined}
                    disabled={!isPro}
                    title={isPro ? undefined : "Professional pakette aktif olur"}
                    className={`flex-1 sm:flex-none px-5 py-2.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm ${isPro ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 hover:bg-emerald-500 hover:text-white" : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500"}`}
                >
                    <TrendingUp className="w-4 h-4" />
                    + Gelir {!isPro && <LockKeyhole className="w-3 h-3" />}
                </button>
                <button
                    onClick={() => isPro ? setShowExpenseModal(true) : undefined}
                    disabled={!isPro}
                    title={isPro ? undefined : "Professional pakette aktif olur"}
                    className={`flex-1 sm:flex-none px-5 py-2.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm ${isPro ? "bg-rose-500/10 text-rose-600 border border-rose-500/20 hover:bg-rose-500 hover:text-white" : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500"}`}
                >
                    <TrendingDown className="w-4 h-4" />
                    - Gider {!isPro && <LockKeyhole className="w-3 h-3" />}
                </button>
                <button
                    onClick={() => setShowSupplierPaymentModal(true)}
                    className="flex-1 sm:flex-none px-5 py-2.5 bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-indigo-500 hover:text-white transition-all shadow-sm"
                >
                    <Plus className="w-4 h-4" />
                    Tedarikçi Ödeme
                </button>
            </div>


            {/* Muhasebe ayrımı: tahsilat / bekleyen / borçlar / ödenmiş gider / net kasa
                Net Kasa = Tahsil edilen gelir − Ödenmiş giderler.
                Tedarikçi ve montajcı borçları BEKLEYEN yükümlülüktür, net kasaya karışmaz. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <StatCard title="Tahsil Edilen" value={loading ? "..." : formatTL(monthOrderPayments)} icon={Receipt} subtitle="sipariş ödemeleri (dönem)" bg="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200" onClick={() => setShowMonthPaymentsModal(true)} />
                <StatCard title="Bekleyen Tahsilat" value={loading ? "..." : formatTL(pendingCollectionTotal)} icon={Wallet} subtitle="müşteriden alınacak" bg="bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200" onClick={() => setShowCollectionModal(true)} />
                <StatCard title="Tedarikçi Borcu" value={loading ? "..." : formatTL(supplierDebtTotal)} icon={Receipt} subtitle="sipariş alış maliyetleri − ödemeler" bg="bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-200" onClick={() => setShowSupplierPaymentModal(true)} />
                <StatCard title="Montajcı Borcu" value={loading ? "..." : formatTL(installerDebtTotal)} icon={TrendingDown} subtitle="tamamlanan iş hakedişi − ödemeler" bg="bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200" onClick={() => nav("/installers")} />
                <StatCard title="Ödenmiş Gider" value={loading ? "..." : formatTL(totalExpense)} icon={TrendingDown} subtitle="tedarikçi + montajcı + genel" bg="bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200" onClick={() => setShowExpenseListModal(true)} />
                <StatCard title="Net Kasa" value={loading ? "..." : formatTL(net)} icon={Wallet} subtitle={`tahsilat − ödenmiş gider · ${healthLabel}`} bg="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200" />
            </div>

            {showFinancialDetails ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard title="Kesilen Fatura" value={loading ? "..." : formatTL(invoiceTotal)} icon={Receipt} subtitle="seçili dönem" bg="bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200" />
                <StatCard title="Tedarikçi Borcu" value={loading ? "..." : formatTL(supplierDebtTotal)} icon={Receipt} subtitle="açık bakiye" bg="bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-200" />
                <StatCard title="Personel Maaş Yükü" value={loading ? "..." : formatTL(salarySgkTotal)} icon={Wallet} subtitle="maaş / SGK" bg="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" />
                <StatCard title="SGK / Vergi Yaklaşan" value={loading ? "..." : formatTL(upcomingObligationTotal)} icon={BarChart3} subtitle="15 gün içinde" bg="bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200" />
            </div>
            ) : null}

            {isPro && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <button onClick={() => setShowFinancialDetails((value) => !value)} className="flex w-full items-center justify-between gap-3 text-left">
                    <div className="min-w-0">
                        <div className="font-black text-slate-900 dark:text-white">Detaylar</div>
                        <div className="text-sm text-slate-500">KDV, avans, tahsilat oranı ve aylık kâr göstergeleri.</div>
                    </div>
                    <span className="shrink-0 rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{showFinancialDetails ? "Gizle" : "Göster"}</span>
                </button>
                {showFinancialDetails ? (
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard title="KDV" value={loading ? "..." : formatTL(invoiceVatTotal)} icon={BarChart3} subtitle="fatura KDV" bg="bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200" />
                        <StatCard title="Personel Avans" value={loading ? "..." : formatTL(employeeAdvanceTotal)} icon={Wallet} subtitle="toplam avans" bg="bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-200" />
                        <StatCard title="Tahsilat Oranı" value={loading ? "..." : `%${collectionRate}`} icon={BarChart3} subtitle="tahsil / bekleyen" bg="bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200" />
                        <StatCard title="Aylık Kâr" value={loading ? "..." : formatTL(net)} icon={TrendingUp} subtitle={net >= 0 ? "kârlı dönem" : "zarar riski"} bg="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200" />
                    </div>
                ) : null}
            </div>
            )}

            <div className="hidden">
                <StatCard
                    title="Bugünkü Tahsilat"
                    value={loading ? "…" : formatTL(todayCollection)}
                    icon={Receipt}
                    subtitle="bugün alınan"
                    bg="bg-gradient-to-br from-emerald-500 to-emerald-600"
                />

                <StatCard
                    title="Bu Ay Tahsilat"
                    value={loading ? "…" : formatTL(monthOrderPayments)}
                    icon={TrendingUp}
                    subtitle="sipariş ödemeleri"
                    bg="bg-gradient-to-br from-green-500 to-green-600"
                />

                <StatCard
                    title="Bekleyen Ödemeler"
                    value={loading ? "…" : formatTL(pendingCollectionTotal)}
                    icon={Wallet}
                    subtitle="tahsil edilecek"
                    bg="bg-gradient-to-br from-amber-500 to-amber-600"
                />

                <StatCard
                    title="Kesilen Fatura"
                    value={loading ? "…" : formatTL(invoiceTotal)}
                    icon={Receipt}
                    subtitle="seçili dönem"
                    bg="bg-gradient-to-br from-indigo-500 to-indigo-600"
                />

                <StatCard
                    title="KDV Toplamı"
                    value={loading ? "…" : formatTL(invoiceVatTotal)}
                    icon={BarChart3}
                    subtitle="vergi takibi"
                    bg="bg-gradient-to-br from-cyan-500 to-cyan-600"
                />

                <StatCard
                    title="Net Kasa"
                    value={loading ? "…" : formatTL(net)}
                    icon={Wallet}
                    subtitle={healthLabel}
                    bg="bg-gradient-to-br from-blue-500 to-blue-600"
                />

                <StatCard
                    title="Toplam Gider"
                    value={loading ? "…" : formatTL(totalExpense)}
                    icon={TrendingDown}
                    subtitle="seçili dönem"
                    bg="bg-gradient-to-br from-rose-500 to-red-600"
                />

                <StatCard
                    title="Personel Maaş Yükü"
                    value={loading ? "…" : formatTL(salarySgkTotal)}
                    icon={Wallet}
                    subtitle="maaş / SGK"
                    bg="bg-gradient-to-br from-slate-600 to-slate-800"
                />

                <StatCard
                    title="SGK / Vergi Yaklaşan"
                    value={loading ? "…" : formatTL(upcomingObligationTotal)}
                    icon={BarChart3}
                    subtitle="15 gün içinde"
                    bg="bg-gradient-to-br from-cyan-500 to-cyan-700"
                />

                <StatCard
                    title="Tedarikçi Borcu"
                    value={loading ? "…" : formatTL(supplierDebtTotal)}
                    icon={Receipt}
                    subtitle="açık bakiye"
                    bg="bg-gradient-to-br from-violet-500 to-purple-700"
                />

                <StatCard
                    title="Personel Avans"
                    value={loading ? "…" : formatTL(employeeAdvanceTotal)}
                    icon={Wallet}
                    subtitle="toplam avans"
                    bg="bg-gradient-to-br from-orange-500 to-orange-700"
                />

                <StatCard
                    title="Aylık Kâr"
                    value={loading ? "…" : formatTL(net)}
                    icon={TrendingUp}
                    subtitle={net >= 0 ? "kârlı dönem" : "zarar riski"}
                    bg="bg-gradient-to-br from-teal-500 to-emerald-700"
                />

                <StatCard
                    title="Tahsilat Oranı"
                    value={loading ? "…" : `%${collectionRate}`}
                    icon={BarChart3}
                    subtitle="tahsil / bekleyen"
                    bg="bg-gradient-to-br from-sky-500 to-blue-700"
                />
            </div>

            {showFinancialDetails ? (
            <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {[
                    { label: "Faturalar", path: "/invoices" },
                    { label: "Gelirler", path: "/income" },
                    { label: "Giderler", path: "/expenses" },
                    { label: "Tedarikçi Borçları", path: "/supplier-ledger" },
                    { label: "Cari Hesaplar", path: "/customers" },
                    { label: "Personel / Maaş", path: "/staff" },
                    { label: "Raporlar", path: "/reports" },
                ].map((item) => (
                    <button
                        key={item.label}
                        onClick={() => nav(item.path)}
                        className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                    >
                        <div className="break-words text-sm font-black text-slate-900 dark:text-white">{item.label}</div>
                        <div className="mt-1 text-[11px] font-medium text-slate-500">Muhasebe</div>
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="font-black text-slate-900 dark:text-white">Son Gelirler</h3>
                    <div className="mt-3 space-y-2">
                        {recentIncome.slice(0, 4).map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                                <span className="min-w-0 truncate">{item.description || item.source || "Gelir"}</span>
                                <span className="font-black text-emerald-600">{formatTL(Number(item.amount ?? 0))}</span>
                            </div>
                        ))}
                        {!loading && recentIncome.length === 0 ? <div className="text-sm text-slate-500">Gelir kaydı yok.</div> : null}
                    </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="font-black text-slate-900 dark:text-white">Son Giderler</h3>
                    <div className="mt-3 space-y-2">
                        {recent.filter((item) => item.direction === "out").slice(0, 4).map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                                <span className="min-w-0 truncate">{item.description || item.type || "Gider"}</span>
                                <span className="font-black text-rose-600">{formatTL(Number(item.amount ?? 0))}</span>
                            </div>
                        ))}
                        {!loading && recent.filter((item) => item.direction === "out").length === 0 ? <div className="text-sm text-slate-500">Gider kaydı yok.</div> : null}
                    </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="font-black text-slate-900 dark:text-white">Yaklaşan Ödemeler</h3>
                    <div className="mt-3 space-y-2 text-sm">
                        <div className="flex justify-between rounded-xl bg-amber-50 px-3 py-2 text-amber-800"><span>SGK / Vergi</span><b>{formatTL(upcomingObligationTotal)}</b></div>
                        <div className="flex justify-between rounded-xl bg-violet-50 px-3 py-2 text-violet-800"><span>Tedarikçi</span><b>{formatTL(supplierDebtTotal)}</b></div>
                        <div className="flex justify-between rounded-xl bg-rose-50 px-3 py-2 text-rose-800"><span>Bekleyen gider</span><b>{formatTL(unpaidExpenseTotal)}</b></div>
                    </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="font-black text-slate-900 dark:text-white">Gelir/Gider Grafik</h3>
                    <div className="mt-4 space-y-4">
                        <div>
                            <div className="mb-1 flex justify-between text-xs font-bold text-slate-500"><span>Gelir</span><span>{formatTL(totalIncome)}</span></div>
                            <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-3 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, totalIncome / Math.max(totalIncome, totalExpense, 1) * 100)}%` }} /></div>
                        </div>
                        <div>
                            <div className="mb-1 flex justify-between text-xs font-bold text-slate-500"><span>Gider</span><span>{formatTL(totalExpense)}</span></div>
                            <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-3 rounded-full bg-rose-500" style={{ width: `${Math.min(100, totalExpense / Math.max(totalIncome, totalExpense, 1) * 100)}%` }} /></div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white">Müşteri Cari Hesapları</h3>
                            <p className="text-sm text-slate-500 mt-1">Satış, tahsilat ve kalan alacak özeti.</p>
                        </div>
                        <div className="rounded-xl bg-amber-50 px-3 py-2 text-right text-amber-700">
                            <div className="text-[11px] font-bold uppercase">Toplam Alacak</div>
                            <div className="font-black">{formatTL(customerReceivableTotal)}</div>
                        </div>
                    </div>

                    {loading ? (
                        <p className="text-slate-500">Yükleniyor…</p>
                    ) : customerLedgers.length === 0 ? (
                        <p className="text-slate-500">Müşteri cari hareketi görünmüyor.</p>
                    ) : (
                        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                            {customerLedgers.slice(0, 8).map((row) => (
                                <button
                                    key={row.customer_id}
                                    onClick={() => nav("/customers")}
                                    className="w-full rounded-xl border border-slate-200 p-4 text-left transition hover:border-primary-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="font-bold text-slate-900 dark:text-white break-words">{row.name}</div>
                                            {row.phone ? <div className="text-xs text-slate-500 mt-1">{row.phone}</div> : null}
                                        </div>
                                        <div className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${row.balance > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                                            {row.balance > 0 ? "Alacak" : "Kapalı"}
                                        </div>
                                    </div>
                                    <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                                        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
                                            <div className="text-xs text-slate-500">Satış</div>
                                            <div className="font-bold">{formatTL(row.totalSales)}</div>
                                        </div>
                                        <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700 dark:bg-emerald-900/20">
                                            <div className="text-xs">Tahsilat</div>
                                            <div className="font-bold">{formatTL(row.totalPaid)}</div>
                                        </div>
                                        <div className="rounded-lg bg-amber-50 p-3 text-amber-700 dark:bg-amber-900/20">
                                            <div className="text-xs">Kalan</div>
                                            <div className="font-bold">{formatTL(row.balance)}</div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white">Personel Cari Hesapları</h3>
                            <p className="text-sm text-slate-500 mt-1">Maaş, avans ve prim hareketleri.</p>
                        </div>
                        <div className="flex gap-2">
                            <div className="rounded-xl bg-orange-50 px-3 py-2 text-right text-orange-700">
                                <div className="text-[11px] font-bold uppercase">Avans</div>
                                <div className="font-black">{formatTL(employeeAdvanceTotal)}</div>
                            </div>
                            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-right text-emerald-700">
                                <div className="text-[11px] font-bold uppercase">Prim</div>
                                <div className="font-black">{formatTL(employeeBonusTotal)}</div>
                            </div>
                        </div>
                    </div>

                    {loading ? (
                        <p className="text-slate-500">Yükleniyor…</p>
                    ) : employeeLedgers.length === 0 ? (
                        <p className="text-slate-500">Personel cari hareketi görünmüyor.</p>
                    ) : (
                        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                            {employeeLedgers.slice(0, 8).map((row) => (
                                <button
                                    key={row.employee_id}
                                    onClick={() => nav("/staff")}
                                    className="w-full rounded-xl border border-slate-200 p-4 text-left transition hover:border-primary-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="font-bold text-slate-900 dark:text-white">{row.name}</div>
                                            <div className="text-xs text-slate-500 mt-1">Aylık maaş: {formatTL(row.salary)}</div>
                                        </div>
                                        <div className={`rounded-full px-3 py-1 text-xs font-black ${row.netPosition > 0 ? "bg-blue-100 text-blue-700" : row.netPosition < 0 ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700"}`}>
                                            {row.netPosition > 0 ? "Personele Borç" : row.netPosition < 0 ? "Avans/Alacak" : "Dengede"}
                                        </div>
                                    </div>
                                    <div className="mt-4 grid grid-cols-4 gap-2 text-sm">
                                        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
                                            <div className="text-xs text-slate-500">Maaş</div>
                                            <div className="font-bold">{formatTL(row.salaryPaid)}</div>
                                        </div>
                                        <div className="rounded-lg bg-orange-50 p-3 text-orange-700 dark:bg-orange-900/20">
                                            <div className="text-xs">Avans</div>
                                            <div className="font-bold">{formatTL(row.advance)}</div>
                                        </div>
                                        <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700 dark:bg-emerald-900/20">
                                            <div className="text-xs">Prim</div>
                                            <div className="font-bold">{formatTL(row.bonus)}</div>
                                        </div>
                                        <div className="rounded-lg bg-blue-50 p-3 text-blue-700 dark:bg-blue-900/20">
                                            <div className="text-xs">Net</div>
                                            <div className="font-bold">{formatTL(Math.abs(row.netPosition))}</div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                <div className="bg-gradient-to-br from-amber-500 to-amber-600 p-6 rounded-2xl text-white shadow-lg shadow-amber-500/20">
                    <p className="text-amber-100 font-medium">Bekleyen Giderler</p>
                    <h3 className="text-3xl font-bold mt-2">
                        {loading ? "…" : formatTL(unpaidExpenseTotal)}
                    </h3>
                    <p className="text-sm text-amber-100 mt-4 bg-white/20 inline-block px-2 py-1 rounded">
                        paid dışı kayıtlar
                    </p>
                </div>

                <div className="bg-gradient-to-br from-violet-500 to-violet-600 p-6 rounded-2xl text-white shadow-lg shadow-violet-500/20">
                    <p className="text-violet-100 font-medium">Tedarikçiye Ödenecek</p>
                    <h3 className="text-3xl font-bold mt-2">
                        {loading ? "…" : formatTL(supplierDebtTotal)}
                    </h3>
                    <p className="text-sm text-violet-100 mt-4 bg-white/20 inline-block px-2 py-1 rounded">
                        supplier bağlı borçlar
                    </p>
                </div>

                <div className="bg-gradient-to-br from-slate-600 to-slate-700 p-6 rounded-2xl text-white shadow-lg shadow-slate-500/20">
                    <p className="text-slate-100 font-medium">Maaş + SGK Toplamı</p>
                    <h3 className="text-3xl font-bold mt-2">
                        {loading ? "…" : formatTL(salarySgkTotal)}
                    </h3>
                    <p className="text-sm text-slate-100 mt-4 bg-white/20 inline-block px-2 py-1 rounded">
                        kategori/not taraması
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
                        Tedarikçi Borç Özeti
                    </h3>

                    {supplierDebts.length === 0 ? (
                        <p className="text-slate-500">Borç görünmüyor.</p>
                    ) : (
                        <div className="space-y-3">
                            {supplierDebts.map((s) => (
                                <div
                                    key={s.supplier_id}
                                    className="p-4 rounded-lg border border-slate-200 dark:border-slate-800"
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                            {s.name}
                                        </div>
                                        <div className="text-sm font-bold text-red-600">
                                            Kalan: {formatTL(s.remaining)}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-3 text-sm">
                                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                            <div className="text-slate-500">Borç</div>
                                            <div className="font-semibold text-slate-900 dark:text-white mt-1">
                                                {formatTL(s.totalDebt)}
                                            </div>
                                        </div>

                                        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                                            <div className="text-slate-500">Ödenen</div>
                                            <div className="font-semibold text-green-600 mt-1">
                                                {formatTL(s.totalPaid)}
                                            </div>
                                        </div>

                                        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20">
                                            <div className="text-slate-500">Kalan</div>
                                            <div className="font-semibold text-red-600 mt-1">
                                                {formatTL(s.remaining)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
                        Son Tedarikçi Ödemeleri
                    </h3>

                    {loading ? (
                        <p className="text-slate-500">Yükleniyor…</p>
                    ) : recentSupplierPayments.length === 0 ? (
                        <p className="text-slate-500">Henüz tedarikçi ödemesi yok.</p>
                    ) : (
                        <div className="space-y-3">
                            {recentSupplierPayments.map((p) => (
                                <div
                                    key={p.id}
                                    className="flex items-center justify-between gap-4 p-3 rounded-lg border border-slate-200 dark:border-slate-800"
                                >
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-slate-900 dark:text-white">
                                            {getSupplierName(p.supplier_id)}
                                            {p.payment_method ? (
                                                <span className="text-slate-500"> — {p.payment_method}</span>
                                            ) : null}
                                        </div>

                                        <div className="text-xs text-slate-500">
                                            {formatDateTR(p.payment_date)}
                                            {p.note ? ` • ${p.note}` : ""}
                                        </div>
                                    </div>

                                    <div className="text-sm font-semibold text-violet-600">
                                        - {formatTL(Number(p.amount ?? 0))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
                        Son Tahsilatlar
                    </h3>

                    {loading ? (
                        <p className="text-slate-500">Yükleniyor…</p>
                    ) : recentPayments.length === 0 ? (
                        <p className="text-slate-500">Henüz tahsilat yok.</p>
                    ) : (
                        <div className="space-y-3">
                            {recentPayments.map((p) => (
                                <div
                                    key={p.id}
                                    className="flex items-center justify-between gap-4 p-3 rounded-lg border border-slate-200 dark:border-slate-800"
                                >
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-slate-900 dark:text-white">
                                            {p.reverses_payment_id ? "Tahsilat İptali" : (p.method || "Tahsilat")}
                                            {p.note ? <span className="text-slate-500"> — {p.note}</span> : null}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            {formatDateTR(p.payment_date)}
                                        </div>
                                    </div>

                                    {p.reverses_payment_id ? (
                                        <div className="text-sm font-semibold text-red-600">
                                            − {formatTL(Number(p.amount ?? 0))}
                                        </div>
                                    ) : (
                                        <div className="text-sm font-semibold text-green-600">
                                            + {formatTL(Number(p.amount ?? 0))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
                        Son Gelir Kayıtları
                    </h3>

                    {loading ? (
                        <p className="text-slate-500">Yükleniyor…</p>
                    ) : recentIncome.length === 0 ? (
                        <p className="text-slate-500">Henüz gelir kaydı yok.</p>
                    ) : (
                        <div className="space-y-3">
                            {recentIncome.map((r) => (
                                <div
                                    key={r.id}
                                    className="flex items-center justify-between gap-4 p-3 rounded-lg border border-slate-200 dark:border-slate-800"
                                >
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-slate-900 dark:text-white">
                                            {r.description || "Gelir"}
                                            {r.source ? (
                                                <span className="text-slate-500"> — {r.source}</span>
                                            ) : null}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            {formatDateTR(r.income_date)}
                                        </div>
                                    </div>

                                    <div className="text-sm font-semibold text-green-600">
                                        + {formatTL(Number(r.amount ?? 0))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Son İşlemler</h3>

                    {loading ? (
                        <p className="text-slate-500">Yükleniyor…</p>
                    ) : recent.length === 0 ? (
                        <p className="text-slate-500">Henüz işlem yok.</p>
                    ) : (
                        <div className="space-y-3">
                            {recent.map((r) => {
                                const dt = r.tx_date ?? r.created_at ?? "";
                                const when = dt ? new Date(dt).toLocaleString("tr-TR") : "-";
                                const isIn = (r.direction ?? "").toLowerCase() === "in";
                                const sign = isIn ? "+" : "-";
                                const amount = Number(r.amount ?? 0);

                                return (
                                    <div
                                        key={r.id}
                                        className="flex items-center justify-between gap-4 p-3 rounded-lg border border-slate-200 dark:border-slate-800"
                                    >
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                                {r.type ?? (isIn ? "income" : "expense")}
                                                {r.description ? (
                                                    <span className="text-slate-500"> — {r.description}</span>
                                                ) : null}
                                            </div>
                                            <div className="text-xs text-slate-500">{when}</div>
                                        </div>

                                        <div
                                            className={`text-sm font-semibold ${isIn ? "text-green-600" : "text-red-600"
                                                }`}
                                        >
                                            {sign} {formatTL(amount)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Muhasebe Özeti</h3>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                        <div className="text-sm text-slate-500">Bugün Tahsilat</div>
                        <div className="mt-2 text-xl font-bold text-green-600">
                            {formatTL(todayCollection)}
                        </div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                        <div className="text-sm text-slate-500">Bu Ay Sipariş Tahsilatı</div>
                        <div className="mt-2 text-xl font-bold text-emerald-600">
                            {formatTL(monthOrderPayments)}
                        </div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                        <div className="text-sm text-slate-500">Bu Ay Gider</div>
                        <div className="mt-2 text-xl font-bold text-red-600">
                            {formatTL(totalExpense)}
                        </div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                        <div className="text-sm text-slate-500">Net Durum</div>
                        <div className={`mt-2 text-xl font-bold ${net >= 0 ? "text-blue-600" : "text-red-600"}`}>
                            {formatTL(net)}
                        </div>
                    </div>
                </div>
            </div>
            </>
            ) : null}

            {showIncomeModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl p-6 pb-safe sm:pb-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Gelir Ekle</h2>
                            <button
                                onClick={() => setShowIncomeModal(false)}
                                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700"
                            >
                                Kapat
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
                            <button
                                type="button"
                                onClick={() => setIncomeSourceType("order")}
                                className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
                                    incomeSourceType === "order"
                                        ? "bg-white dark:bg-slate-950 text-emerald-700 shadow-sm"
                                        : "text-slate-600 dark:text-slate-300"
                                }`}
                            >
                                Siparis Geliri
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setIncomeSourceType("other");
                                    setIncomeOrderId("");
                                }}
                                className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
                                    incomeSourceType === "other"
                                        ? "bg-white dark:bg-slate-950 text-emerald-700 shadow-sm"
                                        : "text-slate-600 dark:text-slate-300"
                                }`}
                            >
                                Diğer
                            </button>
                        </div>

                        {incomeSourceType === "order" ? (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium mb-1">Siparis / Musteri</label>
                                    <select
                                        value={incomeOrderId}
                                        onChange={(e) => {
                                            const nextId = e.target.value;
                                            const nextOrder = orderIncomeOptions.find((o) => o.id === nextId) ?? null;
                                            setIncomeOrderId(nextId);

                                            if (nextOrder) {
                                                const customer = Array.isArray(nextOrder.customer)
                                                    ? nextOrder.customer[0]
                                                    : nextOrder.customer;
                                                const remaining =
                                                    nextOrder.remaining_amount != null
                                                        ? Number(nextOrder.remaining_amount ?? 0)
                                                        : Math.max(
                                                            Number(nextOrder.total_amount ?? 0) -
                                                            Number(nextOrder.paid_amount ?? 0),
                                                            0
                                                        );

                                                setIncomeDescription(`${customer?.name || "Musteri"} perde satisi`);
                                                if (!incomeAmount.trim() && remaining > 0) {
                                                    setIncomeAmount(String(remaining));
                                                }
                                            }
                                        }}
                                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                    >
                                        <option value="">Siparis sec</option>
                                        {orderIncomeOptions.map((o) => {
                                            const customer = Array.isArray(o.customer) ? o.customer[0] : o.customer;
                                            const total = Number(o.total_amount ?? 0);
                                            const paid = Number(o.paid_amount ?? 0);
                                            const remaining =
                                                o.remaining_amount != null
                                                    ? Number(o.remaining_amount ?? 0)
                                                    : Math.max(total - paid, 0);

                                            return (
                                                <option key={o.id} value={o.id}>
                                                    {(customer?.name || "İsimsiz Musteri")} - {formatTL(remaining)} kalan
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>

                                {selectedIncomeOrder ? (
                                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-xs font-semibold uppercase opacity-70">
                                                    Secili siparis
                                                </div>
                                                <div className="mt-1 font-bold break-words">
                                                    {selectedIncomeCustomer?.name || "İsimsiz Musteri"}
                                                </div>
                                                <div className="text-xs opacity-70">
                                                    {selectedIncomeCustomer?.phone || "Telefon yok"} - #{selectedIncomeOrder.id.slice(0, 8)}
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <div className="text-xs opacity-70">Kalan</div>
                                                <div className="text-lg font-black">
                                                    {formatTL(selectedIncomeOrderRemaining)}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                                            <div className="rounded-lg bg-white/70 p-2">
                                                <div className="opacity-60">Siparis Toplami</div>
                                                <div className="font-semibold">{formatTL(selectedIncomeOrderTotal)}</div>
                                            </div>
                                            <div className="rounded-lg bg-white/70 p-2">
                                                <div className="opacity-60">Odenen</div>
                                                <div className="font-semibold">{formatTL(selectedIncomeOrderPaid)}</div>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        <div>
                            <label className="block text-sm font-medium mb-1">Tutar</label>
                            <input
                                value={incomeAmount}
                                onChange={(e) => setIncomeAmount(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="0"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Açıklama</label>
                            <input
                                value={incomeDescription}
                                onChange={(e) => setIncomeDescription(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="Örn: Stor perde satışı"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Ödeme Yöntemi</label>
                            <input
                                value={incomePaymentMethod}
                                onChange={(e) => setIncomePaymentMethod(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="Nakit / Havale / Kart"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Not</label>
                            <textarea
                                value={incomeNote}
                                onChange={(e) => setIncomeNote(e.target.value)}
                                rows={3}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="İsteğe bağlı not"
                            />
                        </div>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowIncomeModal(false)}
                                className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                            >
                                Vazgeç
                            </button>
                            <button
                                onClick={saveIncome}
                                disabled={saving}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-60"
                            >
                                {saving ? "Kaydediliyor..." : "Kaydet"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showExpenseModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Gider Ekle</h2>
                            <button
                                onClick={() => setShowExpenseModal(false)}
                                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700"
                            >
                                Kapat
                            </button>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Tutar</label>
                            <input
                                value={expenseAmount}
                                onChange={(e) => setExpenseAmount(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="0"
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-medium mb-1">Tarih</label>
                                <input
                                    type="date"
                                    value={expenseDate}
                                    onChange={(e) => setExpenseDate(e.target.value)}
                                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Ödeme Tarihi / Vade</label>
                                <input
                                    type="date"
                                    value={expenseDueDate}
                                    onChange={(e) => setExpenseDueDate(e.target.value)}
                                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Kategori</label>
                            <select
                                value={expenseCategory}
                                onChange={(e) => setExpenseCategory(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                            >
                                {EXPENSE_CATEGORIES.map((item) => (
                                    <option key={item} value={item}>{item}</option>
                                ))}
                            </select>
                        </div>

                        {expenseNeedsPeriod ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/10">
                                <div className="mb-2 text-xs font-black uppercase text-amber-800 dark:text-amber-200">İlgili ay</div>
                                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                                    {MONTHS_TR.map((month) => (
                                        <button
                                            key={month}
                                            type="button"
                                            onClick={() => setExpensePeriodMonth(month)}
                                            className={`rounded-xl px-3 py-2 text-sm font-bold transition ${expensePeriodMonth === month ? "bg-amber-600 text-white" : "bg-white text-amber-800 dark:bg-slate-900 dark:text-amber-100"}`}
                                        >
                                            {month}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        <div>
                            <label className="block text-sm font-medium mb-1">Belge No / Fatura No</label>
                            <input
                                value={expenseDocumentNo}
                                onChange={(e) => setExpenseDocumentNo(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="Fatura, makbuz veya referans no"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Tedarikçi</label>
                            <select
                                value={expenseSupplierId}
                                onChange={(e) => setExpenseSupplierId(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                            >
                                <option value="">Tedarikçi seçmeden devam et</option>
                                {suppliers.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name || "İsimsiz Tedarikçi"}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {selectedSupplierDebt && (
                            <div
                                className={`rounded-xl border p-4 ${
                                    selectedSupplierDebt.remaining > 0
                                        ? "bg-amber-50 border-amber-200 text-amber-900"
                                        : selectedSupplierDebt.remaining < 0
                                            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                                            : "bg-slate-50 border-slate-200 text-slate-800"
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
                                            Seçili tedarikçi bakiyesi
                                        </div>
                                        <div className="mt-1 font-bold break-words">
                                            {selectedSupplierDebt.name}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className="text-xs opacity-70">
                                            {selectedSupplierDebt.remaining > 0
                                                ? "Borçlu"
                                                : selectedSupplierDebt.remaining < 0
                                                    ? "Alacaklı"
                                                    : "Kapalı"}
                                        </div>
                                        <div className="text-lg font-black">
                                            {formatTL(Math.abs(selectedSupplierDebt.remaining))}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                                    <div className="rounded-lg bg-white/70 p-2">
                                        <div className="opacity-60">Toplam Borç</div>
                                        <div className="font-semibold">{formatTL(selectedSupplierDebt.totalDebt)}</div>
                                    </div>
                                    <div className="rounded-lg bg-white/70 p-2">
                                        <div className="opacity-60">Toplam Ödenen</div>
                                        <div className="font-semibold">{formatTL(selectedSupplierDebt.totalPaid)}</div>
                                    </div>
                                </div>

                                {supplierPaymentAmount.trim() ? (
                                    <div className="mt-3 text-sm font-medium">
                                        Ödeme sonrası:{" "}
                                        <span className={selectedSupplierRemainingAfterPayment > 0 ? "text-amber-700" : selectedSupplierRemainingAfterPayment < 0 ? "text-emerald-700" : "text-slate-700"}>
                                            {selectedSupplierRemainingAfterPayment > 0
                                                ? `${formatTL(selectedSupplierRemainingAfterPayment)} borç kalır`
                                                : selectedSupplierRemainingAfterPayment < 0
                                                    ? `${formatTL(Math.abs(selectedSupplierRemainingAfterPayment))} alacaklı olur`
                                                    : "bakiye kapanır"}
                                        </span>
                                    </div>
                                ) : null}
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium mb-1">Serbest Açıklama / Vendor</label>
                            <input
                                value={expenseVendor}
                                onChange={(e) => setExpenseVendor(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="Örn: Nakliye, Serbest gider açıklaması"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Ödeme Yöntemi</label>
                            <input
                                value={expensePaymentMethod}
                                onChange={(e) => setExpensePaymentMethod(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="Nakit / Havale / Kart"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Durum</label>
                            <select
                                value={expenseStatus}
                                onChange={(e) => setExpenseStatus(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                            >
                                <option value="paid">Ödendi</option>
                                <option value="unpaid">Ödenmedi</option>
                                <option value="partial">Kısmi</option>
                            </select>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                            <label className="flex items-center gap-2 text-sm font-semibold">
                                <input
                                    type="checkbox"
                                    checked={expenseIsInstallment}
                                    onChange={(e) => setExpenseIsInstallment(e.target.checked)}
                                />
                                Taksitli gider
                            </label>
                            <label className="flex items-center gap-2 text-sm font-semibold">
                                <input
                                    type="checkbox"
                                    checked={expenseIsRecurring}
                                    onChange={(e) => setExpenseIsRecurring(e.target.checked)}
                                />
                                Tekrarlayan ödeme
                            </label>
                            {expenseIsInstallment ? (
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium mb-1">Taksit Sayısı</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={expenseInstallmentCount}
                                        onChange={(e) => setExpenseInstallmentCount(e.target.value)}
                                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                    />
                                </div>
                            ) : null}
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Not</label>
                            <textarea
                                value={expenseNote}
                                onChange={(e) => setExpenseNote(e.target.value)}
                                rows={3}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="İsteğe bağlı not"
                            />
                        </div>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowExpenseModal(false)}
                                className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                            >
                                Vazgeç
                            </button>
                            <button
                                onClick={saveExpense}
                                disabled={saving}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-60"
                            >
                                {saving ? "Kaydediliyor..." : "Kaydet"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Bu Ay Tahsilat Modalı (müşteri ödemeleri) ── */}
            {showMonthPaymentsModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
                    <div className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl my-8">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4">
                            <div>
                                <h2 className="text-xl font-black text-slate-900 dark:text-white">Bu Ay Tahsilatlar</h2>
                                <p className="text-xs text-slate-500 mt-0.5">Müşterilerden gelen sipariş ödemeleri — toplam {formatTL(monthOrderPayments)}</p>
                            </div>
                            <button onClick={() => setShowMonthPaymentsModal(false)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1 text-sm">Kapat</button>
                        </div>
                        <div className="px-6 py-4">
                            {monthPaymentRows.length === 0 ? (
                                <div className="py-8 text-center text-sm text-slate-500">Bu dönemde müşteri tahsilatı yok.</div>
                            ) : (
                                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                                                <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500">Tarih</th>
                                                <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500">Müşteri / Açıklama</th>
                                                <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500 hidden sm:table-cell">Sipariş No</th>
                                                <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500 hidden sm:table-cell">Yöntem</th>
                                                <th className="px-4 py-3 text-right text-xs font-black uppercase text-slate-500">Tutar</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {monthPaymentRows.map((r, i) => (
                                                <tr key={r.id} className={`border-b border-slate-50 dark:border-slate-800 ${i % 2 === 0 ? "" : "bg-slate-50/50 dark:bg-slate-950/30"}`}>
                                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.income_date ? new Date(r.income_date).toLocaleDateString("tr-TR") : "—"}</td>
                                                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{r.description || "—"}</td>
                                                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{r.order_id ? `#${r.order_id.slice(0, 8).toUpperCase()}` : "—"}</td>
                                                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell capitalize">{r.payment_method || "—"}</td>
                                                    <td className="px-4 py-3 text-right font-black text-emerald-600">{formatTL(Number(r.amount ?? 0))}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Toplam Gider Modalı (tedarikçi ödemeleri) ── */}
            {showExpenseListModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
                    <div className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl my-8">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4">
                            <div>
                                <h2 className="text-xl font-black text-slate-900 dark:text-white">Tedarikçi Ödemeleri</h2>
                                <p className="text-xs text-slate-500 mt-0.5">Tedarikçilere yapılan tüm ödemeler</p>
                            </div>
                            <button onClick={() => setShowExpenseListModal(false)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1 text-sm">Kapat</button>
                        </div>
                        <div className="px-6 py-4">
                            {supplierPaymentRows.length === 0 ? (
                                <div className="py-8 text-center text-sm text-slate-500">Tedarikçi ödemesi yok.</div>
                            ) : (
                                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                                                <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500">Tarih</th>
                                                <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500">Tedarikçi</th>
                                                <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500 hidden sm:table-cell">Yöntem</th>
                                                <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500 hidden sm:table-cell">Not</th>
                                                <th className="px-4 py-3 text-right text-xs font-black uppercase text-slate-500">Tutar</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {supplierPaymentRows.map((r: any, i: number) => (
                                                <tr key={r.id} className={`border-b border-slate-50 dark:border-slate-800 ${i % 2 === 0 ? "" : "bg-slate-50/50 dark:bg-slate-950/30"}`}>
                                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.transaction_date ? new Date(r.transaction_date).toLocaleDateString("tr-TR") : "—"}</td>
                                                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{getSupplierName(r.supplier_id)}</td>
                                                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell capitalize">{r.payment_method || "—"}</td>
                                                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell max-w-[200px] truncate" title={r.description || ""}>{r.description || "—"}</td>
                                                    <td className="px-4 py-3 text-right font-black text-rose-600">{formatTL(Number(r.amount ?? 0))}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Bekleyen Tahsilat Modalı ── */}
            {showCollectionModal && (() => {
                const todayStr = new Date().toISOString().slice(0, 10);
                const pendingOrders = orderIncomeOptions
                    .filter((o) => {
                        const total = Number(o.total_amount ?? 0);
                        const paid = Number(o.paid_amount ?? 0);
                        const remaining = o.remaining_amount != null ? Number(o.remaining_amount) : Math.max(total - paid, 0);
                        return remaining > 0.01;
                    })
                    .sort((a, b) => {
                        // Vadesi olanlar önce, vade tarihine göre artan
                        const da = orderDueDates[a.id] || "9999-12-31";
                        const db = orderDueDates[b.id] || "9999-12-31";
                        return da.localeCompare(db);
                    });

                const selectedCollOrder = collectionOrderId ? orderIncomeOptions.find((o) => o.id === collectionOrderId) : null;
                const selectedCollCustomer = selectedCollOrder ? (Array.isArray(selectedCollOrder.customer) ? selectedCollOrder.customer[0] : selectedCollOrder.customer) : null;
                const selectedCollTotal = Number(selectedCollOrder?.total_amount ?? 0);
                const selectedCollPaid = Number(selectedCollOrder?.paid_amount ?? 0);
                const selectedCollRemaining = selectedCollOrder?.remaining_amount != null
                    ? Number(selectedCollOrder.remaining_amount)
                    : Math.max(selectedCollTotal - selectedCollPaid, 0);
                const collAmountNum = Number(collectionAmount || 0);
                const collAfterPay = selectedCollRemaining - collAmountNum;

                return (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
                    <div className="w-full max-w-4xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl my-8">
                        {/* Başlık */}
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4">
                            <h2 className="text-xl font-black text-slate-900 dark:text-white">Bekleyen Tahsilatlar</h2>
                            <button onClick={() => { setShowCollectionModal(false); setCollectionOrderId(""); setCollectionAmount(""); }} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1 text-sm">Kapat</button>
                        </div>

                        {/* Özet satırı */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3 text-center">
                                <div className="text-[10px] font-bold uppercase text-amber-600">Toplam Bekleyen</div>
                                <div className="mt-1 text-lg font-black text-amber-800 dark:text-amber-200">{formatTL(pendingCollectionTotal)}</div>
                            </div>
                            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-center">
                                <div className="text-[10px] font-bold uppercase text-slate-500">Borçlu Müşteri</div>
                                <div className="mt-1 text-lg font-black text-slate-800 dark:text-slate-200">{pendingOrders.length} sipariş</div>
                            </div>
                            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 p-3 text-center">
                                <div className="text-[10px] font-bold uppercase text-emerald-600">Bugün Tahsil</div>
                                <div className="mt-1 text-lg font-black text-emerald-800 dark:text-emerald-200">{formatTL(todayCollection)}</div>
                            </div>
                            <div className="rounded-xl bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/40 p-3 text-center">
                                <div className="text-[10px] font-bold uppercase text-green-600">Bu Ay Tahsil</div>
                                <div className="mt-1 text-lg font-black text-green-800 dark:text-green-200">{formatTL(monthOrderPayments)}</div>
                            </div>
                        </div>

                        <div className="px-6 py-4 space-y-4">
                            {/* Tahsilat formu — sipariş seçilince genişle */}
                            {collectionOrderId && selectedCollOrder && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/10 p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-black text-amber-900 dark:text-amber-100">Tahsilat Yap</h3>
                                        <button onClick={() => { setCollectionOrderId(""); setCollectionAmount(""); }} className="text-slate-400 hover:text-slate-600">✕</button>
                                    </div>
                                    <div className="text-sm text-slate-700 dark:text-slate-300 font-medium">
                                        {selectedCollCustomer?.name || "Müşteri"} — Sipariş #{collectionOrderId.slice(0, 8).toUpperCase()}
                                    </div>
                                    {/* Bakiye özeti */}
                                    <div className="grid grid-cols-3 gap-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
                                        <div className="text-center">
                                            <div className="text-[10px] font-bold uppercase text-slate-500">Sipariş Toplamı</div>
                                            <div className="mt-1 text-sm font-black text-slate-700 dark:text-slate-300">{formatTL(selectedCollTotal)}</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] font-bold uppercase text-emerald-600">Ödenen</div>
                                            <div className="mt-1 text-sm font-black text-emerald-700 dark:text-emerald-300">{formatTL(selectedCollPaid)}</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] font-bold uppercase text-red-600">Kalan Borç</div>
                                            <div className="mt-1 text-sm font-black text-red-700 dark:text-red-300">{formatTL(selectedCollRemaining)}</div>
                                        </div>
                                    </div>
                                    {/* Form alanları */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 mb-1">Tarih</label>
                                            <input type="date" value={collectionDate} onChange={(e) => setCollectionDate(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950 text-sm" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 mb-1">Tahsil Edilecek Tutar (₺)</label>
                                            <input type="number" min={0} value={collectionAmount} onChange={(e) => setCollectionAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950 text-sm" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 mb-1">Ödeme Yöntemi</label>
                                            <select value={collectionMethod} onChange={(e) => setCollectionMethod(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950 text-sm">
                                                <option value="nakit">Nakit</option>
                                                <option value="eft">EFT</option>
                                                <option value="havale">Havale</option>
                                                <option value="kredi_karti">Kredi Kartı</option>
                                                <option value="cek">Çek</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 mb-1">Not</label>
                                            <input value={collectionNote} onChange={(e) => setCollectionNote(e.target.value)} placeholder="İsteğe bağlı" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950 text-sm" />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-xs font-bold text-slate-500 mb-1">Kalan tutar için vade tarihi (opsiyonel)</label>
                                            <input type="date" value={collectionDueDate} onChange={(e) => setCollectionDueDate(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950 text-sm" />
                                            <p className="mt-1 text-[10px] text-slate-400">Kısmi ödeme yapıldıysa kalan borcun ne zaman tahsil edileceğini belirler.</p>
                                        </div>
                                    </div>
                                    {/* Canlı hesaplama */}
                                    {collectionAmount && collAmountNum > 0 && (
                                        <div className={`rounded-lg px-4 py-2 text-sm font-bold ${collAfterPay < -0.01 ? "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-300" : "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300"}`}>
                                            {collAfterPay < -0.01
                                                ? `⚠ Kalan borçtan (${formatTL(selectedCollRemaining)}) fazla girilemez!`
                                                : `Tahsilat sonrası kalan: ${formatTL(Math.max(collAfterPay, 0))}`
                                            }
                                        </div>
                                    )}
                                    <button onClick={saveCollection} disabled={saving} className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60">
                                        {saving ? "Kaydediliyor..." : "Tahsilatı Kaydet"}
                                    </button>
                                </div>
                            )}

                            {/* Sipariş listesi */}
                            {pendingOrders.length === 0 ? (
                                <div className="py-8 text-center text-sm text-slate-500">Bekleyen tahsilat yok.</div>
                            ) : (
                                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                                                <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500">Müşteri</th>
                                                <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500 hidden sm:table-cell">Tel</th>
                                                <th className="px-4 py-3 text-right text-xs font-black uppercase text-slate-500">Toplam</th>
                                                <th className="px-4 py-3 text-right text-xs font-black uppercase text-slate-500">Ödenen</th>
                                                <th className="px-4 py-3 text-right text-xs font-black uppercase text-slate-500">Kalan</th>
                                                <th className="px-4 py-3 text-left text-xs font-black uppercase text-slate-500 hidden sm:table-cell">Vade</th>
                                                <th className="px-4 py-3"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {pendingOrders.map((o, i) => {
                                                const cust = Array.isArray(o.customer) ? o.customer[0] : o.customer;
                                                const tot = Number(o.total_amount ?? 0);
                                                const pd = Number(o.paid_amount ?? 0);
                                                const rem = o.remaining_amount != null ? Number(o.remaining_amount) : Math.max(tot - pd, 0);
                                                const isSelected = collectionOrderId === o.id;
                                                const due = orderDueDates[o.id];
                                                const isOverdue = due ? due < todayStr : false;
                                                return (
                                                    <tr key={o.id} className={`border-b border-slate-50 dark:border-slate-800 ${isSelected ? "bg-amber-50 dark:bg-amber-950/10" : i % 2 === 0 ? "" : "bg-slate-50/50 dark:bg-slate-950/30"}`}>
                                                        <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{cust?.name || "—"}</td>
                                                        <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{cust?.phone || "—"}</td>
                                                        <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">{formatTL(tot)}</td>
                                                        <td className="px-4 py-3 text-right text-emerald-600 font-bold">{formatTL(pd)}</td>
                                                        <td className="px-4 py-3 text-right text-red-600 font-black">{formatTL(rem)}</td>
                                                        <td className="px-4 py-3 hidden sm:table-cell">
                                                            {due ? (
                                                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${isOverdue ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" : due === todayStr ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                                                                    {isOverdue ? "⚠ " : ""}{new Date(due + "T12:00:00").toLocaleDateString("tr-TR")}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400 text-xs">—</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <button
                                                                onClick={() => { setCollectionOrderId(o.id); setCollectionAmount(""); }}
                                                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700"
                                                            >
                                                                Tahsilat Yap
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                );
            })()}

            {showSupplierPaymentModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                Tedarikçiye Ödeme
                            </h2>
                            <button
                                onClick={() => setShowSupplierPaymentModal(false)}
                                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700"
                            >
                                Kapat
                            </button>
                        </div>

                        {/* Tedarikçi seç */}
                        <div>
                            <label className="block text-sm font-medium mb-1">Tedarikçi</label>
                            <select
                                value={supplierPaymentSupplierId}
                                onChange={(e) => setSupplierPaymentSupplierId(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                            >
                                <option value="">Tedarikçi seç</option>
                                {suppliers.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name || "İsimsiz Tedarikçi"}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Bakiye özeti — tedarikçi seçilince göster */}
                        {selectedSupplierDebt && supplierPaymentSupplierId && (
                            <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-100 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 p-3">
                                <div className="text-center">
                                    <div className="text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">Toplam Borç</div>
                                    <div className="mt-1 text-sm font-black text-amber-700 dark:text-amber-300">{formatTL(selectedSupplierDebt.totalDebt)}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">Ödenen</div>
                                    <div className="mt-1 text-sm font-black text-emerald-700 dark:text-emerald-300">{formatTL(selectedSupplierDebt.totalPaid)}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-[10px] font-bold uppercase text-red-600 dark:text-red-400">Kalan Bakiye</div>
                                    <div className="mt-1 text-sm font-black text-red-700 dark:text-red-300">{formatTL(selectedSupplierDebt.remaining)}</div>
                                </div>
                            </div>
                        )}

                        {/* Tarih + Tutar */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-medium mb-1">Tarih</label>
                                <input
                                    type="date"
                                    value={supplierPaymentDate}
                                    onChange={(e) => setSupplierPaymentDate(e.target.value)}
                                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Tutar (₺)</label>
                                <input
                                    type="number"
                                    min={0}
                                    value={supplierPaymentAmount}
                                    onChange={(e) => setSupplierPaymentAmount(e.target.value)}
                                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>

                        {/* Canlı hesaplama */}
                        {supplierPaymentAmount.trim() && Number(supplierPaymentAmount) > 0 && selectedSupplierDebt && (
                            <div className={`rounded-lg px-4 py-2 text-sm font-bold ${selectedSupplierRemainingAfterPayment < 0 ? "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-300" : "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300"}`}>
                                {selectedSupplierRemainingAfterPayment < 0
                                    ? `⚠ Ödeme bakiyeyi ${formatTL(Math.abs(selectedSupplierRemainingAfterPayment))} aşıyor!`
                                    : `Ödeme sonrası kalan: ${formatTL(selectedSupplierRemainingAfterPayment)}`
                                }
                            </div>
                        )}

                        {/* Kalan borç vadesi */}
                        <div>
                            <label className="block text-sm font-medium mb-1">Kalan borç için vade tarihi (opsiyonel)</label>
                            <input
                                type="date"
                                value={supplierPaymentDueDate}
                                onChange={(e) => setSupplierPaymentDueDate(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                            />
                            <p className="mt-1 text-[10px] text-slate-400">Kısmi ödeme yapılıyorsa kalan borcun ne zaman ödeneceğini belirler.</p>
                        </div>

                        {/* Ödeme yöntemi + Not */}
                        <div>
                            <label className="block text-sm font-medium mb-1">Ödeme Yöntemi</label>
                            <select
                                value={supplierPaymentMethod}
                                onChange={(e) => setSupplierPaymentMethod(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                            >
                                <option value="nakit">Nakit</option>
                                <option value="eft">EFT</option>
                                <option value="havale">Havale</option>
                                <option value="kredi_karti">Kredi Kartı</option>
                                <option value="cek">Çek</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Not</label>
                            <textarea
                                value={supplierPaymentNote}
                                onChange={(e) => setSupplierPaymentNote(e.target.value)}
                                rows={2}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                                placeholder="İsteğe bağlı not"
                            />
                        </div>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowSupplierPaymentModal(false)}
                                className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
                            >
                                Vazgeç
                            </button>
                            <button
                                onClick={saveSupplierPayment}
                                disabled={saving}
                                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-60"
                            >
                                {saving ? "Kaydediliyor..." : "Kaydet"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
