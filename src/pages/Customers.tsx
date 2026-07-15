import { useEffect, useState, useMemo, useRef } from "react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { createFinanceService } from "../services/finance";
import { useNavigate } from "react-router-dom";
import { PAGE_SIZE } from "../constants/pagination";
import { Pagination } from "../components/Pagination";
import {
    Edit3,
    Plus,
    Save,
    Search,
    Trash2,
    X,
    ArrowLeft,
    RefreshCw,
    PhoneCall,
    MapPin,
    MessageCircle,
    Wallet,
    User,
    Calendar,
    Wrench,
    CheckCircle,
    Hammer,
    Truck,
    Package,
    Clock,
    MessageSquare,
    ChevronRight,
    Check,
    Award,
    TrendingUp,
    Users,
    AlertCircle,
    FileText,
    FileSignature,
    ClipboardCheck,
    HelpCircle,
    Printer,
    Download
} from "lucide-react";
import { normalizeRole, type RoleState } from "../auth/roles";
import { findDuplicatePhone, duplicatePhoneMessage, phoneConstraintMessage } from "../utils/phoneUtils";
import { withoutDeleted } from "../utils/softDelete";

type Customer = {
    id: string;
    created_at: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    note: string | null;
};

type CustomerForm = {
    name: string;
    phone: string;
    email: string;
    address: string;
    note: string;
};

type CustomerLedger = {
    totalSales: number;
    totalPaid: number;
    balance: number;
    /** Siparişe bağlı olmayan fazla ödeme / avans toplamı (müşteri alacağı) */
    advance: number;
    entries: CustomerLedgerEntry[];
};

type CrmNote = {
    id: string;
    date: string;
    text: string;
};

const PAYMENT_METHODS: { value: string; label: string }[] = [
    { value: "nakit", label: "Nakit" },
    { value: "havale", label: "Havale" },
    { value: "kart", label: "Kart" },
    { value: "diger", label: "Diğer" },
];

/** Bugünün tarihini yerel saat dilimine göre yyyy-mm-dd formatında döner (date input için). */
function todayStr() {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

type CustomerLedgerEntry = {
    id: string;
    date: string | null;
    label: string;
    debit: number;
    credit: number;
    balance: number;
};

const emptyForm: CustomerForm = {
    name: "",
    phone: "",
    email: "",
    address: "",
    note: "",
};

function formatTL(value: number) {
    return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
}

function formatStmtDate(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("tr-TR");
}

// ── Müşteri Cari Ekstresi satırı ─────────────────────────────
// Kaynak: orders (Borç +) + gerçek payments satırları (Alacak −).
// orders.paid_amount/remaining_amount CACHE'İ KULLANILMAZ — hareketler
// doğrudan sipariş ve tahsilat kayıtlarından türetilir.
type StatementRow = {
    id: string;
    date: string;
    label: string;
    debit: number;   // Borç (+): sipariş tutarı veya tahsilat iptali (borcu geri açar)
    credit: number;  // Alacak (−): tahsilat
    type: "order" | "payment" | "reversal";
    balance: number; // kronolojik running balance
};

function buildCustomerStatement(customerId: string, orders: any[], payments: any[]): StatementRow[] {
    const rows: Omit<StatementRow, "balance">[] = [];

    // Sipariş → order_id/müşteri eşlemesi (RPC tahsilatları customer_id taşımaz,
    // order_id üzerinden müşteriye bağlanır).
    const orderCustomer = new Map<string, string | null>();
    for (const o of orders) {
        if (o?.id) orderCustomer.set(o.id, o.customer_id ?? null);
    }

    // Borç (+): müşterinin siparişleri (taslak/iptal hariç)
    for (const o of orders) {
        if (o?.customer_id !== customerId) continue;
        if (o?.status === "draft" || o?.status === "cancelled") continue;
        const total = Number(o?.total_amount ?? 0);
        if (total <= 0) continue;
        rows.push({
            id: `order-${o.id}`,
            date: o?.created_at ?? "",
            label: `Sipariş #${String(o.id).slice(0, 8).toUpperCase()}`,
            debit: total,
            credit: 0,
            type: "order",
        });
    }

    // Alacak (−): gerçek tahsilat satırları.
    // NOT: Tahsilat iptali (reverses_payment_id) prod şemasında yok; şimdilik
    // tüm tahsilatlar Alacak (−) olarak işlenir (reversal mantığı devre dışı).
    for (const p of payments) {
        const cid = p?.customer_id ?? (p?.order_id ? orderCustomer.get(p.order_id) : null);
        if (cid !== customerId) continue;
        const amount = Number(p?.amount ?? 0);
        if (amount <= 0) continue;
        rows.push({
            id: `pay-${p.id}`,
            date: p?.payment_date ?? "",
            label: p?.note || "Tahsilat",
            debit: 0,
            credit: amount,
            type: "payment",
        });
    }

    // Kronolojik sırala (aynı tarihte borç önce), running balance hesapla.
    rows.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.type === "payment" ? 1 : -1));
    let running = 0;
    return rows.map((r) => {
        running = Math.round((running + r.debit - r.credit) * 100) / 100;
        return { ...r, balance: running };
    });
}

/** DB unique constraint hatasını kullanıcı dostu mesaja çevirir */
function phoneErrorMessage(rawError: string, phone?: string): string {
    return phoneConstraintMessage(rawError, phone);
}

function cleanPhone(phone?: string | null) {
    return String(phone || "").replace(/[^\d+]/g, "");
}

function whatsappUrl(customer: Customer) {
    const phone = cleanPhone(customer.phone);
    const text = encodeURIComponent(`Merhaba ${customer.name || ""}`);
    return phone ? `https://wa.me/${phone.replace(/^\+/, "")}?text=${text}` : `https://wa.me/?text=${text}`;
}

function mapsUrl(customer: Customer) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address || customer.name || "")}`;
}

async function getContext() {
    return getEffectiveTenantContext();
}

function parseCrmNotes(noteField: string | null): CrmNote[] {
    if (!noteField) return [];
    const trimmed = noteField.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
            return JSON.parse(trimmed) as CrmNote[];
        } catch (e) {
            // Fallback
        }
    }
    return [{
        id: "legacy",
        date: new Date().toISOString(),
        text: noteField
    }];
}

function formatApptDate(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString("tr-TR")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function getStepStatus(
    stepKey: string,
    customer: Customer,
    ledger: CustomerLedger,
    appts: any[],
    orders: any[]
): "completed" | "active" | "pending" {
    if (stepKey === "customer") return "completed";

    if (stepKey === "measurement") {
        const hasDone = appts.some(a => a.type === "measurement" && (a.status === "done" || a.status === "measured" || a.status === "completed"));
        if (hasDone) return "completed";
        const hasPlanned = appts.some(a => a.type === "measurement" && (a.status === "planned" || a.status === "onway"));
        if (hasPlanned) return "active";
        return "pending";
    }

    if (stepKey === "quote") {
        const hasApproved = orders.some(o => !["draft", "quoted", "cancelled"].includes(o.status));
        if (hasApproved) return "completed";
        const hasQuotes = orders.some(o => o.status === "quoted" || o.status === "draft");
        if (hasQuotes) return "active";
        return "pending";
    }

    if (stepKey === "order") {
        const hasPostOrder = orders.some(o => !["draft", "quoted", "approved", "cancelled"].includes(o.status));
        if (hasPostOrder) return "completed";
        const hasApproved = orders.some(o => o.status === "approved");
        if (hasApproved) return "active";
        return "pending";
    }

    if (stepKey === "payment") {
        if (ledger.totalSales > 0) {
            if (ledger.totalPaid + ledger.advance >= ledger.totalSales) return "completed";
            if (ledger.totalPaid + ledger.advance > 0) return "active";
        }
        return "pending";
    }

    if (stepKey === "install") {
        const hasCompletedInstall = orders.some(o => ["installation_completed", "completed", "delivered_closed"].includes(o.status)) ||
            appts.some(a => a.type === "installation" && (a.status === "done" || a.status === "completed"));
        if (hasCompletedInstall) return "completed";
        const hasPlannedInstall = appts.some(a => a.type === "installation" && (a.status === "planned" || a.status === "onway")) ||
            orders.some(o => ["installation_ready", "installation_waiting", "installation_planned", "installing"].includes(o.status));
        if (hasPlannedInstall) return "active";
        return "pending";
    }

    if (stepKey === "delivery") {
        const hasDelivered = orders.some(o => ["completed", "delivered_closed"].includes(o.status));
        if (hasDelivered) return "completed";
        return "pending";
    }

    return "pending";
}

function getCustomerBadges(
    c: Customer,
    ledger: CustomerLedger,
    appts: any[],
    orders: any[]
) {
    const badges = [];
    const netBalance = ledger.balance - ledger.advance;

    // VIP check
    if (ledger.totalSales >= 25000) {
        badges.push({ label: "⭐ VIP", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40" });
    }

    // Debtor check
    if (netBalance > 0.01) {
        badges.push({ label: "🔴 Borçlu", cls: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-900/40" });
    } else if (netBalance < -0.01) {
        badges.push({ label: "🔵 Avanslı", cls: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 border border-sky-200 dark:border-sky-900/40" });
    }

    // Active orders check
    const cOrders = orders.filter(o => o.customer_id === c.id);
    const hasActiveOrders = cOrders.some(o => !["cancelled", "draft", "completed", "delivered_closed"].includes(o.status));
    if (hasActiveOrders) {
        badges.push({ label: "🟢 Aktif", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40" });
    }

    // Pending measurements check
    const cAppts = appts.filter(a => a.customer_id === c.id);
    const hasMeasurements = cAppts.some(a => a.type === "measurement" && (a.status === "done" || a.status === "measured" || a.status === "completed"));
    if (hasMeasurements && cOrders.length === 0) {
        badges.push({ label: "🟡 Beklemede", cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-900/40" });
    }

    return badges;
}

export default function Customers() {
    const nav = useNavigate();

    const [companyId, setCompanyId] = useState<string>("");
    const [userId, setUserId] = useState<string>("");
    const [role, setRole] = useState<RoleState>("unknown");
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [form, setForm] = useState<CustomerForm>(emptyForm);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<CustomerForm>(emptyForm);
    const [ledgerMap, setLedgerMap] = useState<Record<string, CustomerLedger>>({});
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

    // New state variables for premium CRM page
    const [allAppointments, setAllAppointments] = useState<any[]>([]);
    const [allOrders, setAllOrders] = useState<any[]>([]);
    const [allPayments, setAllPayments] = useState<any[]>([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [activeFilter, setActiveFilter] = useState("all");
    const [detailTab, setDetailTab] = useState("general");
    const [newCrmNote, setNewCrmNote] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
    const [collectSuccessState, setCollectSuccessState] = useState<{
        show: boolean;
        prevRemaining: number;
        newRemaining: number;
        appliedAmount: number;
        overpayment: number;
    } | null>(null);

    // Tahsilat (collection) modal state
    const [collectCustomer, setCollectCustomer] = useState<Customer | null>(null);
    const [collectAmount, setCollectAmount] = useState("");
    const [collectDate, setCollectDate] = useState(todayStr());
    const [collectMethod, setCollectMethod] = useState("nakit");
    const [collectNote, setCollectNote] = useState("");
    const [collectSaving, setCollectSaving] = useState(false);
    // Tahsilat "niyeti" başına stabil idempotency anahtarı. Hata/yeniden denemede
    // korunur (mükerrer tahsilat olmaz); tahsilat içeriği değişince yeni niyet başlar.
    const collectIntentKeyRef = useRef<string | null>(null);
    useEffect(() => {
        // İçerik değişti → yeni tahsilat niyeti; sonraki denemede taze anahtar üretilir.
        collectIntentKeyRef.current = null;
    }, [collectCustomer?.id, collectAmount, collectDate, collectMethod, collectNote]);
    const [collectError, setCollectError] = useState("");
    const [toast, setToast] = useState("");

    // Cari ekstre modal state
    const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);

    // Debounce search query
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    async function loadData() {
        setLoading(true);
        try {
            const ctx = await getContext();
            setCompanyId(ctx.company_id);
            setUserId(ctx.user.id);

            const { data: profile } = await supabase
                .from("profiles")
                .select("role")
                .eq("user_id", ctx.user.id)
                .maybeSingle();
            const nextRole = normalizeRole(profile?.role);
            setRole(nextRole);

            // Fetch everything we need in one phase
            const [custRes, ordersRes, apptsRes, paymentsRes] = await Promise.all([
                withoutDeleted(supabase
                    .from("customers")
                    .select("*", { count: 'exact' })
                    .eq("company_id", ctx.company_id))
                    .order("created_at", { ascending: false })
                    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1),
                withoutDeleted(supabase
                    .from("orders")
                    .select("id, created_at, customer_id, total_amount, paid_amount, remaining_amount, status")
                    .eq("company_id", ctx.company_id)),
                withoutDeleted(supabase
                    .from("appointments")
                    .select("id, created_at, customer_id, title, type, status, start_at, address, note, assigned_to, created_by")
                    .eq("company_id", ctx.company_id)),
                withoutDeleted(supabase
                    .from("payments")
                    .select("id, customer_id, order_id, amount, payment_date, method, note")
                    .eq("company_id", ctx.company_id))
            ]);

            if (custRes.error) throw custRes.error;
            if (paymentsRes.error) throw paymentsRes.error;

            setTotalPages(Math.ceil((custRes.count || 0) / PAGE_SIZE));

            const orders = ordersRes.data ?? [];
            const appointments = apptsRes.data ?? [];
            const payments = paymentsRes.data ?? [];

            setAllOrders(orders);
            setAllAppointments(appointments);
            setAllPayments(payments);

            // RLS and view restrictions for installer
            let allowedCustomerIds: Set<string> | null = null;
            if (nextRole === "installer") {
                allowedCustomerIds = new Set<string>();
                for (const row of appointments) {
                    if ((row.assigned_to === ctx.user.id || row.created_by === ctx.user.id) && row.customer_id) {
                        allowedCustomerIds.add(row.customer_id);
                    }
                }
            }

            const nextCustomers = ((custRes.data as Customer[]) ?? []).filter((customer) => {
                if (!allowedCustomerIds) return true;
                return allowedCustomerIds.has(customer.id);
            });
            setCustomers(nextCustomers);

            if (nextRole === "installer") {
                setLedgerMap({});
                return;
            }

            // Financial maps construction
            const nextLedger: Record<string, CustomerLedger> = {};
            
            // 1. Process orders
            orders.forEach((order: any) => {
                if (!order.customer_id) return;
                if (order.status === "draft" || order.status === "cancelled") return;

                const total = Number(order.total_amount ?? 0);
                const paid = Number(order.paid_amount ?? 0);
                const remaining = order.remaining_amount != null 
                    ? Number(order.remaining_amount ?? 0) 
                    : Math.max(total - paid, 0);

                if (!nextLedger[order.customer_id]) {
                    nextLedger[order.customer_id] = { totalSales: 0, totalPaid: 0, balance: 0, advance: 0, entries: [] };
                }

                nextLedger[order.customer_id].totalSales += total;
                nextLedger[order.customer_id].totalPaid += paid;
                nextLedger[order.customer_id].balance += Math.max(remaining, 0);
                nextLedger[order.customer_id].entries.push({
                    id: `${order.id}-sale`,
                    date: order.created_at ?? null,
                    label: "Sipariş",
                    debit: total,
                    credit: 0,
                    balance: total,
                });

                if (paid > 0) {
                    nextLedger[order.customer_id].entries.push({
                        id: `${order.id}-payment`,
                        date: order.created_at ?? null,
                        label: paid >= total ? "Tahsilat" : "Kapora / Tahsilat",
                        debit: 0,
                        credit: paid,
                        balance: Math.max(remaining, 0),
                    });
                }
            });

            // 2. Process payments that are advances (order_id is null)
            payments.forEach((pay: any) => {
                const cid = pay.customer_id;
                if (!cid || pay.order_id !== null) return;
                const amount = Number(pay.amount ?? 0);
                if (amount <= 0) return;

                if (!nextLedger[cid]) {
                    nextLedger[cid] = { totalSales: 0, totalPaid: 0, balance: 0, advance: 0, entries: [] };
                }

                nextLedger[cid].advance += amount;
                nextLedger[cid].entries.push({
                    id: `adv-${pay.id}`,
                    date: pay.payment_date ?? null,
                    label: "Fazla Ödeme / Avans",
                    debit: 0,
                    credit: amount,
                    balance: 0,
                });
            });

            setLedgerMap(nextLedger);
        } catch (e: any) {
            alert(e.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page]);

    async function addCustomer() {
        if (!form.name.trim()) {
            alert("İsim boş olamaz");
            return;
        }
        if (!companyId) {
            alert("Şirket bilgisi henüz yükleniyor. Lütfen birkaç saniye bekleyip tekrar deneyin.");
            return;
        }

        // Telefon duplicate kontrolü
        if (form.phone.trim() && companyId) {
            const duplicate = await findDuplicatePhone({ companyId, phone: form.phone.trim() });
            if (duplicate) {
                alert(duplicatePhoneMessage(duplicate.name, form.phone.trim()));
                return;
            }
        }

        const { error } = await supabase.from("customers").insert({
            company_id: companyId,
            name: form.name.trim(),
            phone: form.phone.trim() || null,
            email: form.email.trim() || null,
            address: form.address.trim() || null,
            note: form.note.trim() || null,
            created_by: userId || null,
        });

        if (error && String(error.message || "").toLowerCase().includes("created_by")) {
            const retry = await supabase.from("customers").insert({
                company_id: companyId,
                name: form.name.trim(),
                phone: form.phone.trim() || null,
                email: form.email.trim() || null,
                address: form.address.trim() || null,
                note: form.note.trim() || null,
            });
            if (retry.error) {
                alert(phoneErrorMessage(retry.error.message, form.phone.trim()));
                return;
            }
        } else if (error) {
            alert(phoneErrorMessage(error.message, form.phone.trim()));
            return;
        }

        setForm(emptyForm);
        setShowAddForm(false); // Auto-collapse form
        await loadData();
    }

    function startEdit(customer: Customer) {
        setEditingId(customer.id);
        setEditForm({
            name: customer.name ?? "",
            phone: customer.phone ?? "",
            email: customer.email ?? "",
            address: customer.address ?? "",
            note: customer.note ?? "",
        });
    }

    async function updateCustomer() {
        if (!editingId) return;
        if (!editForm.name.trim()) {
            alert("İsim boş olamaz");
            return;
        }

        // Güncelleme sırasında telefon duplicate kontrolü (kendisi hariç)
        if (editForm.phone.trim() && companyId) {
            const duplicate = await findDuplicatePhone({
                companyId,
                phone: editForm.phone.trim(),
                existingCustomerId: editingId,
            });
            if (duplicate) {
                alert(duplicatePhoneMessage(duplicate.name, editForm.phone.trim()));
                return;
            }
        }

        const { error } = await supabase
            .from("customers")
            .update({
                name: editForm.name.trim(),
                phone: editForm.phone.trim() || null,
                email: editForm.email.trim() || null,
                address: editForm.address.trim() || null,
                note: editForm.note.trim() || null,
            })
            .eq("id", editingId)
            .eq("company_id", companyId);

        if (error) {
            alert(phoneErrorMessage(error.message, editForm.phone.trim()));
            return;
        }

        setEditingId(null);
        await loadData();
    }

    async function deleteCustomer(customer: Customer) {
        const ok = confirm(`${customer.name || "Bu müşteri"} silinsin mi?`);
        if (!ok) return;

        const { error } = await supabase
            .from("customers")
            .delete()
            .eq("id", customer.id)
            .eq("company_id", companyId);

        if (error) {
            alert(error.message);
            return;
        }

        await loadData();
    }

    function openCollect(customer: Customer) {
        setCollectCustomer(customer);
        setCollectAmount("");
        setCollectDate(todayStr());
        setCollectMethod("nakit");
        setCollectNote("");
        setCollectError("");
        setCollectSuccessState(null);
    }

    // ── Cari ekstre (statement) ─────────────────────────────
    const statementRows = useMemo(
        () => (statementCustomer ? buildCustomerStatement(statementCustomer.id, allOrders, allPayments) : []),
        [statementCustomer, allOrders, allPayments],
    );

    const statementTotals = useMemo(() => {
        const salesTotal = statementRows
            .filter((r) => r.type === "order")
            .reduce((s, r) => s + r.debit, 0);
        // Net tahsilat = tahsilatlar − iptaller
        const paidNet = statementRows.reduce(
            (s, r) => s + r.credit - (r.type === "reversal" ? r.debit : 0),
            0,
        );
        const balance = Math.round((salesTotal - paidNet) * 100) / 100;
        return { salesTotal, paidNet, balance };
    }, [statementRows]);

    function exportStatementCSV() {
        if (!statementCustomer || statementRows.length === 0) return;
        const headers = ["Tarih", "Açıklama", "Borç (+)", "Alacak (-)", "Bakiye"];
        const rows = statementRows.map((r) => [
            formatStmtDate(r.date),
            r.label,
            r.debit > 0 ? r.debit.toFixed(2) : "0.00",
            r.credit > 0 ? r.credit.toFixed(2) : "0.00",
            r.balance.toFixed(2),
        ]);
        const content = [headers, ...rows].map((row) => row.join(";")).join("\n");
        const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute(
            "download",
            `musteri_${(statementCustomer.name || "isimsiz").toLowerCase().replace(/\s+/g, "_")}_cari_ekstre_${new Date().toISOString().slice(0, 10)}.csv`,
        );
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function exportStatementPDF() {
        if (!statementCustomer || statementRows.length === 0) return;
        const rows = statementRows
            .map(
                (r) => `
                    <tr>
                        <td>${formatStmtDate(r.date)}</td>
                        <td>${r.label}</td>
                        <td style="text-align: right; color: #dc2626;">${
                            r.debit > 0
                                ? (r.type === "reversal" ? `+ ${formatTL(r.debit)} (iptal)` : `+ ${formatTL(r.debit)}`)
                                : "—"
                        }</td>
                        <td style="text-align: right; color: #16a34a;">${r.credit > 0 ? `− ${formatTL(r.credit)}` : "—"}</td>
                        <td style="text-align: right; font-weight: bold; color: ${r.balance > 0 ? "#b91c1c" : "#15803d"};">${formatTL(r.balance)}</td>
                    </tr>`,
            )
            .join("");

        const printWindow = window.open("", "_blank", "width=1200,height=800");
        if (!printWindow) return;
        printWindow.document.write(`
            <html>
                <head>
                    <title>Müşteri Cari Ekstresi - ${statementCustomer.name || ""}</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 30px; color: #1e293b; background: #fff; }
                        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #cbd5e1; padding-bottom: 20px; margin-bottom: 30px; }
                        .title h1 { margin: 0; font-size: 24px; font-weight: 800; color: #0f172a; }
                        .title p { margin: 5px 0 0 0; font-size: 14px; color: #64748b; }
                        .details { font-size: 14px; line-height: 1.6; }
                        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px; }
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
                            <h1>MÜŞTERİ CARİ EKSTRESİ</h1>
                            <p>${statementCustomer.name || "Müşteri"}</p>
                        </div>
                        <div class="details">
                            <div><strong>Tarih:</strong> ${new Date().toLocaleDateString("tr-TR")}</div>
                        </div>
                    </div>
                    <div class="summary-grid">
                        <div class="summary-card">
                            <div class="label">Toplam Sipariş (Borç)</div>
                            <div class="val" style="color: #dc2626;">${formatTL(statementTotals.salesTotal)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="label">Toplam Tahsilat</div>
                            <div class="val" style="color: #16a34a;">${formatTL(statementTotals.paidNet)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="label">${statementTotals.balance < 0 ? "Müşteri Alacağı" : "Kalan Bakiye"}</div>
                            <div class="val" style="color: ${statementTotals.balance > 0 ? "#b91c1c" : "#15803d"};">${formatTL(Math.abs(statementTotals.balance))}</div>
                        </div>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 100px;">Tarih</th>
                                <th>Açıklama</th>
                                <th style="text-align: right; width: 130px;">Borç (+)</th>
                                <th style="text-align: right; width: 130px;">Alacak (−)</th>
                                <th style="text-align: right; width: 130px;">Bakiye</th>
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
        setTimeout(() => printWindow.print(), 400);
    }

    async function submitCollect() {
        if (collectSaving) return;
        if (!collectCustomer) return;
        const amount = Number(collectAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            setCollectError("Geçerli bir tahsilat tutarı girin.");
            return;
        }
        if (!companyId) {
            setCollectError("Şirket bilgisi yüklenemedi. Sayfayı yenileyip tekrar deneyin.");
            return;
        }

        const ledger = ledgerMap[collectCustomer.id] ?? { totalSales: 0, totalPaid: 0, balance: 0, advance: 0, entries: [] };
        const prevRemaining = Math.max(ledger.balance - ledger.advance, 0);

        setCollectSaving(true);
        setCollectError("");
        try {
            const customer = collectCustomer;
            const collectionDate = new Date(`${collectDate || todayStr()}T12:00:00`).toISOString();
            const baseNote = collectNote.trim() || "Müşteri tahsilatı";

            // Müşterinin açık siparişlerini en eskiden başlayarak getir (FIFO dağıtım)
            const { data: orders, error: ordersErr } = await supabase
                .from("orders")
                .select("id, total_amount, paid_amount, remaining_amount, status, created_at")
                .eq("company_id", companyId)
                .eq("customer_id", customer.id)
                .not("status", "eq", "draft")
                .not("status", "eq", "cancelled")
                .order("created_at", { ascending: true });

            if (ordersErr) throw ordersErr;

            const orderRemaining = (o: { total_amount: number | null; paid_amount: number | null; remaining_amount: number | null }) =>
                o.remaining_amount != null
                    ? Number(o.remaining_amount)
                    : Math.max(Number(o.total_amount ?? 0) - Number(o.paid_amount ?? 0), 0);

            // Yalnızca bakiyesi olan açık siparişler (FIFO sırası korunur)
            const openOrders = (orders ?? []).filter((o) => orderRemaining(o) > 0.005);
            if (openOrders.length === 0) {
                throw new Error("Bu müşterinin açık (bakiyeli) siparişi yok. Avans/ön tahsilat için sipariş bazlı tahsilat ekranını kullanın.");
            }

            const totalRemaining = openOrders.reduce((s, o) => s + orderRemaining(o), 0);
            const overpayment = Math.max(amount - totalRemaining, 0);

            // Tüm para yazma işlemi atomik RPC (customer_record_collection) üzerinden.
            // Her sipariş için ayrı idempotency anahtarı: aynı batch iki kez gönderilse
            // bile RPC her satırı replay eder, mükerrer kayıt oluşmaz.
            const finance = createFinanceService();
            // Niyet başına stabil anahtar: yeniden denemede aynı kalır → RPC replay eder.
            if (!collectIntentKeyRef.current) collectIntentKeyRef.current = crypto.randomUUID();
            const batchKey = collectIntentKeyRef.current;

            let remainingToApply = amount;
            for (let i = 0; i < openOrders.length; i++) {
                if (remainingToApply <= 0.005) break;
                const order = openOrders[i];
                const rem = orderRemaining(order);
                const isLast = i === openOrders.length - 1;
                // Son açık sipariş kalan tutarın tamamını üstlenir; fazlası RPC
                // tarafında o siparişin fazla tahsilatı (müşteri alacağı) olarak işlenir.
                const share = isLast ? remainingToApply : Math.min(remainingToApply, rem);
                if (share <= 0.005) continue;

                const res = await finance.customerCollections.recordCollection({
                    companyId,
                    orderId: order.id,
                    amount: share,
                    method: (collectMethod || undefined) as any,
                    date: collectionDate,
                    note: baseNote,
                    idempotencyKey: `${batchKey}:${order.id}`,
                });
                if (res.status !== "success") {
                    throw new Error(res.status === "error" ? res.error.message : "Tahsilat kaydedilemedi.");
                }

                remainingToApply -= share;
            }

            // Tüm siparişler başarıyla işlendi → niyet tamamlandı, anahtarı temizle.
            collectIntentKeyRef.current = null;

            const newRemaining = Math.max(prevRemaining - amount, 0);

            // Show beautiful success preview instead of immediately closing
            setCollectSuccessState({
                show: true,
                prevRemaining,
                newRemaining,
                appliedAmount: amount,
                overpayment
            });

            await loadData();
        } catch (e: any) {
            setCollectError(e?.message ? `Tahsilat kaydedilemedi: ${e.message}` : "Tahsilat kaydedilemedi. Lütfen tekrar deneyin.");
        } finally {
            setCollectSaving(false);
        }
    }

    async function addCrmNote(customer: Customer, text: string) {
        if (!text.trim()) return;
        const currentNotes = parseCrmNotes(customer.note);
        const newNote: CrmNote = {
            id: Math.random().toString(36).substring(2, 9),
            date: new Date().toISOString(),
            text: text.trim()
        };
        const updatedNotes = [newNote, ...currentNotes];
        const serialized = JSON.stringify(updatedNotes);

        const { error } = await supabase
            .from("customers")
            .update({ note: serialized })
            .eq("id", customer.id);

        if (error) {
            alert("Not eklenemedi: " + error.message);
        } else {
            setNewCrmNote("");
            // Update state dynamically
            setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, note: serialized } : c));
        }
    }

    async function deleteCrmNote(customer: Customer, noteId: string) {
        const currentNotes = parseCrmNotes(customer.note);
        const updatedNotes = currentNotes.filter(n => n.id !== noteId);
        const serialized = updatedNotes.length > 0 ? JSON.stringify(updatedNotes) : null;

        const { error } = await supabase
            .from("customers")
            .update({ note: serialized })
            .eq("id", customer.id);

        if (error) {
            alert("Not silinemedi: " + error.message);
        } else {
            // Update state dynamically
            setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, note: serialized } : c));
        }
    }

    // Debounced and category filtered list
    const filtered = useMemo(() => {
        return customers.filter((c) => {
            const matchQuery = debouncedSearchQuery.trim().toLowerCase();
            if (!matchQuery) return true;

            const nameMatch = (c.name ?? "").toLowerCase().includes(matchQuery);
            const phoneMatch = (c.phone ?? "").toLowerCase().includes(matchQuery);
            const addressMatch = (c.address ?? "").toLowerCase().includes(matchQuery);
            const emailMatch = (c.email ?? "").toLowerCase().includes(matchQuery);

            let notesMatch = false;
            if (c.note) {
                const notes = parseCrmNotes(c.note);
                notesMatch = notes.some(n => n.text.toLowerCase().includes(matchQuery));
            }

            return nameMatch || phoneMatch || addressMatch || emailMatch || notesMatch;
        });
    }, [customers, debouncedSearchQuery]);

    const filteredByFilter = useMemo(() => {
        return filtered.filter((c) => {
            const ledger = ledgerMap[c.id] ?? { totalSales: 0, totalPaid: 0, balance: 0, advance: 0, entries: [] };
            const netBalance = ledger.balance - ledger.advance;

            const cAppts = allAppointments.filter(a => a.customer_id === c.id);
            const cOrders = allOrders.filter(o => o.customer_id === c.id);
            const hasMeasurements = cAppts.some(a => a.type === "measurement" && (a.status === "done" || a.status === "measured" || a.status === "completed"));
            const hasActiveOrders = cOrders.some(o => !["cancelled", "draft", "completed", "delivered_closed"].includes(o.status));

            if (activeFilter === "debtor") {
                return netBalance > 0.01;
            }
            if (activeFilter === "vip") {
                return ledger.totalSales >= 25000;
            }
            if (activeFilter === "active") {
                return hasActiveOrders;
            }
            if (activeFilter === "pending") {
                return hasMeasurements && cOrders.length === 0;
            }
            return true;
        });
    }, [filtered, activeFilter, ledgerMap, allAppointments, allOrders]);

    // Top statistical overview computed values
    const stats = useMemo(() => {
        let vipCount = 0;
        let debtorCount = 0;
        let pendingCount = 0;
        let totalReceivable = 0;

        customers.forEach((c) => {
            const ledger = ledgerMap[c.id] ?? { totalSales: 0, totalPaid: 0, balance: 0, advance: 0, entries: [] };
            const netBalance = ledger.balance - ledger.advance;

            if (ledger.totalSales >= 25000) vipCount++;
            if (netBalance > 0.01) {
                debtorCount++;
                totalReceivable += netBalance;
            }

            const cAppts = allAppointments.filter(a => a.customer_id === c.id);
            const cOrders = allOrders.filter(o => o.customer_id === c.id);
            const hasMeasurements = cAppts.some(a => a.type === "measurement" && (a.status === "done" || a.status === "measured" || a.status === "completed"));

            if (hasMeasurements && cOrders.length === 0) {
                pendingCount++;
            }
        });

        return {
            totalCustomers: customers.length,
            vipCount,
            debtorCount,
            pendingCount,
            totalReceivable,
        };
    }, [customers, ledgerMap, allAppointments, allOrders]);

    const selectedCustomer = useMemo(() => customers.find((customer) => customer.id === selectedCustomerId) ?? null, [customers, selectedCustomerId]);
    const selectedLedger = selectedCustomerId
        ? ledgerMap[selectedCustomerId] ?? { totalSales: 0, totalPaid: 0, balance: 0, advance: 0, entries: [] }
        : null;

    const canSeeFinancial = role === "admin" || role === "accountant" || role === "super_admin";

    // Build timeline events for the selected customer
    const timelineItems = useMemo(() => {
        if (!selectedCustomer) return [];

        const events: any[] = [];

        // 1. Customer Created
        events.push({
            id: `cust-created-${selectedCustomer.id}`,
            date: selectedCustomer.created_at || new Date().toISOString(),
            title: "Müşteri Kaydı",
            description: "Müşteri veri tabanına başarıyla kaydedildi.",
            type: "customer",
            icon: <User size={16} className="text-primary-600" />,
            iconBg: "bg-primary-50 dark:bg-primary-950/20",
            status: "completed"
        });

        // 2. Appointments
        const cAppts = allAppointments.filter(a => a.customer_id === selectedCustomer.id);
        cAppts.forEach(appt => {
            const isMeas = appt.type === "measurement";
            const isDone = appt.status === "done" || appt.status === "measured" || appt.status === "completed";
            const dateStr = appt.start_at || appt.created_at || new Date().toISOString();

            events.push({
                id: `appt-${appt.id}`,
                date: dateStr,
                title: isMeas 
                    ? (isDone ? "Ölçü Alındı" : "Ölçü Randevusu Planlandı")
                    : (isDone ? "Montaj Tamamlandı" : "Montaj Randevusu Planlandı"),
                description: `${isMeas ? "Ölçü" : "Montaj"} randevusu zamanı: ${formatApptDate(appt.start_at)}. Not: ${appt.note || "—"}`,
                type: isMeas ? "measurement" : "install",
                icon: isMeas 
                    ? <Calendar size={16} className={isDone ? "text-emerald-600" : "text-blue-500"} />
                    : <Wrench size={16} className={isDone ? "text-emerald-600" : "text-blue-500"} />,
                iconBg: isDone ? "bg-emerald-50 dark:bg-emerald-950/20" : "bg-blue-50 dark:bg-blue-950/20",
                status: isDone ? "completed" : "active"
            });
        });

        // 3. Orders
        const cOrders = allOrders.filter(o => o.customer_id === selectedCustomer.id);
        cOrders.forEach(order => {
            const dateStr = order.created_at || new Date().toISOString();
            let title = "Sipariş";
            let desc = `Sipariş toplam tutarı: ${formatTL(order.total_amount)}`;
            let icon = <FileText size={16} className="text-slate-600" />;
            let iconBg = "bg-slate-50 dark:bg-slate-900";
            let status = "completed";

            if (order.status === "draft") {
                title = "Sipariş Taslağı Oluşturuldu";
                desc = `Sipariş taslağı kaydedildi. Tutar: ${formatTL(order.total_amount)}`;
                icon = <FileText size={16} className="text-slate-400" />;
                iconBg = "bg-slate-100 dark:bg-slate-800";
                status = "pending";
            } else if (order.status === "quoted") {
                title = "Teklif Hazırlandı";
                desc = `Teklif oluşturuldu. Tutar: ${formatTL(order.total_amount)}`;
                icon = <FileSignature size={16} className="text-amber-500" />;
                iconBg = "bg-amber-50 dark:bg-amber-950/20";
                status = "active";
            } else if (order.status === "approved") {
                title = "Teklif Onaylandı (Sipariş)";
                desc = `Teklif onaylanarak aktif siparişe çevrildi. Tutar: ${formatTL(order.total_amount)}`;
                icon = <ClipboardCheck size={16} className="text-emerald-600" />;
                iconBg = "bg-emerald-50 dark:bg-emerald-950/20";
                status = "completed";
            } else if (order.status === "production") {
                title = "Sipariş Üretimde";
                desc = "Perdeler atölyede üretime alındı.";
                icon = <Hammer size={16} className="text-orange-500" />;
                iconBg = "bg-orange-50 dark:bg-orange-950/20";
                status = "active";
            } else if (["installation_ready", "installation_waiting", "installation_planned", "installing"].includes(order.status)) {
                title = "Sipariş Montaj Aşamasına Geçti";
                desc = "Sipariş üretildi ve montaj sırasına / sürecine dahil edildi.";
                icon = <Truck size={16} className="text-sky-500" />;
                iconBg = "bg-sky-50 dark:bg-sky-950/20";
                status = "active";
            } else if (order.status === "installation_completed") {
                title = "Montaj İşlemi Tamamlandı";
                desc = "Perdelerin montajı montaj ekipleri tarafından yapıldı.";
                icon = <CheckCircle size={16} className="text-emerald-600" />;
                iconBg = "bg-emerald-50 dark:bg-emerald-950/20";
                status = "completed";
            } else if (order.status === "completed" || order.status === "delivered_closed") {
                title = "Sipariş Teslim Edildi (Kapatıldı)";
                desc = "Süreç başarıyla tamamlandı ve sipariş teslim edilerek cari hesap kapatıldı.";
                icon = <Package size={16} className="text-emerald-600" />;
                iconBg = "bg-emerald-100 dark:bg-emerald-950/30";
                status = "completed";
            }

            events.push({
                id: `order-${order.id}-${order.status}`,
                date: dateStr,
                title,
                description: desc,
                type: order.status === "quoted" || order.status === "draft" ? "quote" : "order",
                icon,
                iconBg,
                status
            });
        });

        // 4. Payments
        const cPayments = allPayments.filter(p => p.customer_id === selectedCustomer.id);
        cPayments.forEach(pay => {
            const dateStr = pay.payment_date || new Date().toISOString();
            const methodLabel = PAYMENT_METHODS.find(m => m.value === pay.method)?.label || pay.method || "Diğer";
            events.push({
                id: `pay-${pay.id}`,
                date: dateStr,
                title: pay.order_id ? "Tahsilat Alındı" : "Müşteri Avansı Girişi",
                description: `${formatTL(pay.amount)} tutarında ödeme (${methodLabel}) alındı. Not: ${pay.note || "—"}`,
                type: "payment",
                icon: <Wallet size={16} className="text-emerald-600" />,
                iconBg: "bg-emerald-50 dark:bg-emerald-950/20",
                status: "completed"
            });
        });

        // 5. CRM Notes
        const cNotes = parseCrmNotes(selectedCustomer.note);
        cNotes.forEach(note => {
            if (note.id === "legacy" && !note.text) return;
            events.push({
                id: `note-${note.id}`,
                date: note.date,
                title: "Müşteri Notu",
                description: note.text,
                type: "note",
                icon: <MessageSquare size={16} className="text-purple-600" />,
                iconBg: "bg-purple-50 dark:bg-purple-950/20",
                status: "completed"
            });
        });

        // Sort descending
        return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [selectedCustomer, allAppointments, allOrders, allPayments]);

    // Computed customer specific list inside detail modal
    const selectedCustomerAppointments = useMemo(() => {
        if (!selectedCustomerId) return [];
        return allAppointments
            .filter(a => a.customer_id === selectedCustomerId)
            .sort((a, b) => new Date(b.start_at || b.created_at || 0).getTime() - new Date(a.start_at || a.created_at || 0).getTime());
    }, [allAppointments, selectedCustomerId]);

    const selectedCustomerOrders = useMemo(() => {
        if (!selectedCustomerId) return [];
        return allOrders
            .filter(o => o.customer_id === selectedCustomerId)
            .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    }, [allOrders, selectedCustomerId]);

    const selectedCustomerPayments = useMemo(() => {
        if (!selectedCustomerId) return [];
        return allPayments
            .filter(p => p.customer_id === selectedCustomerId)
            .sort((a, b) => new Date(b.payment_date || 0).getTime() - new Date(a.payment_date || 0).getTime());
    }, [allPayments, selectedCustomerId]);

    const activeCustomerCrmNotes = useMemo(() => {
        if (!selectedCustomer) return [];
        return parseCrmNotes(selectedCustomer.note);
    }, [selectedCustomer]);

    // Quick tab class constructor
    const tabClasses = (tabName: string) => `
        flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-bold text-xs transition-all whitespace-nowrap
        ${detailTab === tabName
            ? "bg-slate-900 text-white dark:bg-slate-800 shadow-sm"
            : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/50"
        }
    `;

    return (
        <div className="space-y-6 pb-24 lg:pb-6 font-sans">
            {toast ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300">
                    {toast}
                </div>
            ) : null}

            {/* Header section */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => nav(-1)}
                        className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition shadow-sm"
                        title="Geri Git"
                    >
                        <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Müşteri İlişkileri (CRM)</h1>
                        <p className="text-sm text-slate-500">Müşteri veritabanınızı yönetin, süreçleri ve ödemeleri izleyin.</p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={loadData}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition font-bold text-sm shadow-sm"
                    >
                        <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                        Yenile
                    </button>
                    <button
                        onClick={() => setShowAddForm(!showAddForm)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white font-bold text-sm shadow hover:bg-slate-800 dark:hover:bg-slate-700 transition"
                    >
                        <Plus className="w-4 h-4" />
                        Yeni Müşteri
                    </button>
                </div>
            </div>

            {/* Collapsible Customer Creation Form */}
            {showAddForm && (
                <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-5 bg-white dark:bg-slate-900 shadow-md transition-all duration-300 animate-fadeIn">
                    <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100 dark:border-slate-800">
                        <h3 className="font-extrabold text-slate-900 dark:text-white flex items-center gap-2"><Plus size={18} className="text-primary-600" /> Yeni Müşteri Kaydı</h3>
                        <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold text-slate-500">Ad Soyad *</label>
                            <input className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-transparent focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:outline-none" placeholder="Örn: Ahmet Yılmaz" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold text-slate-500">Telefon</label>
                            <input className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-transparent focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:outline-none" placeholder="Örn: 05001234567" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold text-slate-500">E-posta</label>
                            <input className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-transparent focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:outline-none" placeholder="Örn: ornek@mail.com" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-bold text-slate-500">Adres</label>
                            <input className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-transparent focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:outline-none" placeholder="Örn: Atatürk Mah. 120. Sokak No:5 D:4" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
                        </div>
                        <div className="flex flex-col gap-1 md:col-span-2">
                            <label className="text-xs font-bold text-slate-500">Özel Not</label>
                            <textarea rows={2} className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-transparent focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:outline-none" placeholder="Müşteriye özel not ekleyin..." value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} />
                        </div>
                    </div>
                    <div className="flex gap-2 mt-5">
                        <button
                            onClick={addCustomer}
                            disabled={loading || !companyId}
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm shadow transition disabled:opacity-50"
                        >
                            <Save size={16} /> Müşteriyi Kaydet
                        </button>
                        <button
                            onClick={() => setShowAddForm(false)}
                            className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-sm transition"
                        >
                            Vazgeç
                        </button>
                    </div>
                </div>
            )}

            {/* Premium Stat Cards Filter Rows */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {/* Total Customers */}
                <button
                    onClick={() => setActiveFilter("all")}
                    className={`text-left p-4 rounded-2xl bg-white dark:bg-slate-900 border transition-all duration-200 hover:scale-[1.02] shadow-sm hover:shadow ${
                        activeFilter === "all" ? "border-primary-500 ring-2 ring-primary-500/20" : "border-slate-200 dark:border-slate-800"
                    }`}
                >
                    <div className="flex items-center justify-between text-slate-500 mb-2">
                        <span className="text-xs font-extrabold uppercase tracking-wider">Müşteriler</span>
                        <Users size={18} className="text-primary-500" />
                    </div>
                    <div className="text-2xl font-black">{stats.totalCustomers}</div>
                    <div className="text-[10px] text-slate-400 mt-1">Sistemde kayıtlı toplam</div>
                </button>

                {/* Debtors */}
                <button
                    onClick={() => setActiveFilter("debtor")}
                    className={`text-left p-4 rounded-2xl bg-white dark:bg-slate-900 border transition-all duration-200 hover:scale-[1.02] shadow-sm hover:shadow ${
                        activeFilter === "debtor" ? "border-rose-500 ring-2 ring-rose-500/20" : "border-slate-200 dark:border-slate-800"
                    }`}
                >
                    <div className="flex items-center justify-between text-slate-500 mb-2">
                        <span className="text-xs font-extrabold uppercase tracking-wider">Borçlular</span>
                        <AlertCircle size={18} className="text-rose-500" />
                    </div>
                    <div className="text-2xl font-black text-rose-600 dark:text-rose-400">{stats.debtorCount}</div>
                    <div className="text-[10px] text-slate-400 mt-1">Ödeme bekleyen borçlu</div>
                </button>

                {/* VIP */}
                <button
                    onClick={() => setActiveFilter("vip")}
                    className={`text-left p-4 rounded-2xl bg-white dark:bg-slate-900 border transition-all duration-200 hover:scale-[1.02] shadow-sm hover:shadow ${
                        activeFilter === "vip" ? "border-amber-500 ring-2 ring-amber-500/20" : "border-slate-200 dark:border-slate-800"
                    }`}
                >
                    <div className="flex items-center justify-between text-slate-500 mb-2">
                        <span className="text-xs font-extrabold uppercase tracking-wider">VIP</span>
                        <Award size={18} className="text-amber-500" />
                    </div>
                    <div className="text-2xl font-black text-amber-500">{stats.vipCount}</div>
                    <div className="text-[10px] text-slate-400 mt-1">₺25k+ Ciro yapan müşteri</div>
                </button>

                {/* Pending measurement, no order */}
                <button
                    onClick={() => setActiveFilter("pending")}
                    className={`text-left p-4 rounded-2xl bg-white dark:bg-slate-900 border transition-all duration-200 hover:scale-[1.02] shadow-sm hover:shadow ${
                        activeFilter === "pending" ? "border-yellow-500 ring-2 ring-yellow-500/20" : "border-slate-200 dark:border-slate-800"
                    }`}
                >
                    <div className="flex items-center justify-between text-slate-500 mb-2">
                        <span className="text-xs font-extrabold uppercase tracking-wider">Bekleyen</span>
                        <Clock size={18} className="text-yellow-500" />
                    </div>
                    <div className="text-2xl font-black text-yellow-600 dark:text-yellow-400">{stats.pendingCount}</div>
                    <div className="text-[10px] text-slate-400 mt-1">Ölçüsü alınıp siparişsiz</div>
                </button>

                {/* Total Receivables (Non-clickable overview) */}
                <div
                    className="col-span-2 md:col-span-1 p-4 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 border border-emerald-100 dark:border-emerald-900/30 shadow-sm"
                >
                    <div className="flex items-center justify-between text-emerald-800 dark:text-emerald-300 mb-2">
                        <span className="text-xs font-extrabold uppercase tracking-wider">Toplam Alacak</span>
                        <TrendingUp size={18} className="text-emerald-600" />
                    </div>
                    <div className="text-xl font-black text-emerald-700 dark:text-emerald-300 truncate">{formatTL(stats.totalReceivable)}</div>
                    <div className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70 mt-1">Bekleyen net bakiye</div>
                </div>
            </div>

            {/* Filter buttons & Search bar */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        className="w-full border border-slate-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors text-sm"
                        placeholder="Ad soyad, telefon, adres veya not içeriği ile ara..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <div className="flex gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl self-start sm:self-auto overflow-x-auto max-w-full">
                    <button
                        onClick={() => setActiveFilter("all")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                            activeFilter === "all"
                                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
                                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        }`}
                    >
                        Tümü ({customers.length})
                    </button>
                    <button
                        onClick={() => setActiveFilter("debtor")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                            activeFilter === "debtor"
                                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
                                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        }`}
                    >
                        Borçlu ({stats.debtorCount})
                    </button>
                    <button
                        onClick={() => setActiveFilter("vip")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                            activeFilter === "vip"
                                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
                                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        }`}
                    >
                        VIP ({stats.vipCount})
                    </button>
                    <button
                        onClick={() => setActiveFilter("pending")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                            activeFilter === "pending"
                                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
                                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        }`}
                    >
                        Bekleyenler ({stats.pendingCount})
                    </button>
                </div>
            </div>

            {/* Customers list grid */}
            <div className="space-y-4">
                {loading && (
                    <div className="flex items-center justify-center py-12 text-slate-500 gap-2">
                        <RefreshCw className="animate-spin" size={18} /> Yükleniyor...
                    </div>
                )}
                {!loading && filteredByFilter.length === 0 && (
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center text-slate-500">
                        Kayıt bulunamadı.
                    </div>
                )}

                {filteredByFilter.map((c) => {
                    const isEditing = editingId === c.id;
                    const ledger = ledgerMap[c.id] ?? { totalSales: 0, totalPaid: 0, balance: 0, advance: 0, entries: [] };
                    const netBalance = ledger.balance - ledger.advance;
                    const displayPaid = ledger.totalPaid + ledger.advance;
                    const displayRemaining = Math.max(netBalance, 0);
                    const badges = getCustomerBadges(c, ledger, allAppointments, allOrders);

                    return (
                        <div key={c.id} className="group border border-slate-200 dark:border-slate-800 rounded-2xl p-5 bg-white dark:bg-slate-900 shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-200">
                            {isEditing ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-bold text-slate-400">Ad Soyad</label>
                                        <input className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-transparent focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-bold text-slate-400">Telefon</label>
                                        <input className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-transparent focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-bold text-slate-400">E-posta</label>
                                        <input className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-transparent focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-bold text-slate-400">Adres</label>
                                        <input className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-transparent focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={editForm.address} onChange={(e) => setEditForm((p) => ({ ...p, address: e.target.value }))} />
                                    </div>
                                    <div className="flex flex-col gap-1 md:col-span-2">
                                        <label className="text-xs font-bold text-slate-400">Notlar</label>
                                        <input className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-transparent focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={editForm.note} onChange={(e) => setEditForm((p) => ({ ...p, note: e.target.value }))} />
                                    </div>
                                    <div className="md:col-span-2 flex flex-col sm:flex-row gap-2 mt-2">
                                        <button onClick={updateCustomer} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition shadow-sm">
                                            <Save className="w-4 h-4" /> Kaydet
                                        </button>
                                        <button onClick={() => setEditingId(null)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold transition">
                                            <X className="w-4 h-4" /> Vazgeç
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                                    <div className="min-w-0 flex-1 cursor-pointer" onClick={() => {
                                        setSelectedCustomerId(c.id);
                                        setDetailTab("general");
                                    }}>
                                        <div className="flex flex-wrap items-center gap-2 mb-2">
                                            <div className="font-extrabold text-lg text-slate-800 dark:text-slate-100 group-hover:text-primary-600 transition-colors">{c.name}</div>
                                            {badges.map((b, idx) => (
                                                <span key={idx} className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${b.cls}`}>
                                                    {b.label}
                                                </span>
                                            ))}
                                        </div>

                                        <div className="flex flex-col gap-1 text-sm text-slate-500 mb-4">
                                            {c.phone && (
                                                <span className="flex items-center gap-1.5"><PhoneCall size={14} className="text-slate-400" /> {c.phone}</span>
                                            )}
                                            {c.address && (
                                                <span className="flex items-center gap-1.5"><MapPin size={14} className="text-slate-400" /> {c.address}</span>
                                            )}
                                            {c.note && (
                                                <span className="flex items-center gap-1.5 text-xs text-slate-400 italic">
                                                    <MessageSquare size={12} /> {parseCrmNotes(c.note)[0]?.text || c.note}
                                                </span>
                                            )}
                                        </div>

                                        {canSeeFinancial && (
                                            <div className="grid grid-cols-3 gap-2.5 max-w-md">
                                                <div className="rounded-xl bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100/30 p-2.5">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Satış</div>
                                                    <div className="font-black text-sm text-blue-600 dark:text-blue-400">{formatTL(ledger.totalSales)}</div>
                                                </div>
                                                <div className="rounded-xl bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-100/30 p-2.5">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tahsilat</div>
                                                    <div className="font-black text-sm text-emerald-600 dark:text-emerald-400">{formatTL(displayPaid)}</div>
                                                </div>
                                                <div className="rounded-xl bg-amber-50/50 dark:bg-amber-950/10 border border-amber-100/30 p-2.5">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Kalan</div>
                                                    <div className="font-black text-sm text-amber-600 dark:text-amber-400">{formatTL(displayRemaining)}</div>
                                                </div>
                                            </div>
                                        )}
                                        
                                        <div className="mt-3 text-xs font-bold text-primary-600 dark:text-primary-400 hover:underline">
                                            {canSeeFinancial ? "Detaylar, Randevular ve Zaman Çizelgesi için dokunun ➜" : "Müşteri detayları için dokunun ➜"}
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 shrink-0 border-t lg:border-t-0 pt-4 lg:pt-0 border-slate-100 dark:border-slate-800">
                                        {c.phone ? (
                                            <>
                                                <a href={whatsappUrl(c)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/10 transition shadow-sm" title="WhatsApp Gönder">
                                                    <MessageCircle className="w-5 h-5" />
                                                </a>
                                                <a href={`tel:${cleanPhone(c.phone)}`} className="inline-flex items-center justify-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-sm" title="Ara">
                                                    <PhoneCall className="w-5 h-5" />
                                                </a>
                                            </>
                                        ) : null}
                                        <a href={mapsUrl(c)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-sm" title="Haritada Göster">
                                            <MapPin className="w-5 h-5" />
                                        </a>
                                        {canSeeFinancial ? (
                                            <button onClick={() => openCollect(c)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition shadow-sm" title="Tahsilat Yap">
                                                <Wallet className="w-4 h-4" /> <span>Tahsilat Yap</span>
                                            </button>
                                        ) : null}
                                        {canSeeFinancial ? (
                                            <button onClick={() => setStatementCustomer(c)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs transition shadow-sm" title="Cari Ekstre">
                                                <FileText className="w-4 h-4" /> <span>Ekstre</span>
                                            </button>
                                        ) : null}
                                        <button onClick={() => startEdit(c)} className="inline-flex items-center justify-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-sm" title="Müşteri Düzenle">
                                            <Edit3 className="w-5 h-5" />
                                        </button>
                                        <button onClick={() => deleteCustomer(c)} className="inline-flex items-center justify-center p-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-950/20 dark:hover:bg-red-950/30 transition shadow-sm" title="Müşteriyi Sil">
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {!loading && filteredByFilter.length > 0 && totalPages > 0 && (
                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        isLoading={loading}
                    />
                )}
            </div>

            {/* Premium Tabbed Details CRM Modal */}
            {selectedCustomer && selectedLedger && (
                <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 backdrop-blur-xs p-0 sm:items-center sm:p-4 animate-fadeIn">
                    <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white dark:bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6 flex flex-col border border-slate-200 dark:border-slate-850">
                        {/* Header details */}
                        <div className="flex justify-between items-start gap-4 pb-4 border-b border-slate-100 dark:border-slate-800 mb-4">
                            <div className="min-w-0">
                                <span className="text-xs font-black uppercase text-primary-600 dark:text-primary-400">Müşteri CRM Kartı</span>
                                <h2 className="break-words text-2xl font-black text-slate-900 dark:text-white mt-0.5">{selectedCustomer.name}</h2>
                                <p className="text-sm text-slate-500 mt-0.5">{selectedCustomer.phone || "Telefon belirtilmemiş"}</p>
                            </div>
                            <button
                                onClick={() => setSelectedCustomerId(null)}
                                className="rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2 text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-sm"
                            >
                                Kapat
                            </button>
                        </div>

                        {/* Quick Actions Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
                            <button
                                onClick={() => {
                                    setSelectedCustomerId(null);
                                    nav("/measurements/new", {
                                        state: {
                                            fresh: true,
                                            customerId: selectedCustomer.id,
                                            customerName: selectedCustomer.name,
                                            phone: selectedCustomer.phone,
                                            address: selectedCustomer.address
                                        }
                                    });
                                }}
                                className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/45 transition font-extrabold text-xs"
                            >
                                <Calendar size={16} /> Yeni Ölçü Girişi
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedCustomerId(null);
                                    nav("/orders/new", {
                                        state: {
                                            customerId: selectedCustomer.id,
                                            customerName: selectedCustomer.name,
                                            phone: selectedCustomer.phone,
                                            address: selectedCustomer.address
                                        }
                                    });
                                }}
                                className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-950/45 transition font-extrabold text-xs"
                            >
                                <FileText size={16} /> Yeni Sipariş Oluştur
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedCustomerId(null);
                                    nav("/appointments/new", {
                                        state: {
                                            customerId: selectedCustomer.id
                                        }
                                    });
                                }}
                                className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/45 transition font-extrabold text-xs"
                            >
                                <Clock size={16} /> Randevu Oluştur
                            </button>
                            {canSeeFinancial && (
                                <button
                                    onClick={() => openCollect(selectedCustomer)}
                                    className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/45 transition font-extrabold text-xs"
                                >
                                    <Wallet size={16} /> Tahsilat Al
                                </button>
                            )}
                        </div>

                        {/* CRM Modal Tabs Navigation */}
                        <div className="flex border-b border-slate-100 dark:border-slate-800 mb-6 overflow-x-auto pb-1 gap-1">
                            <button onClick={() => setDetailTab("general")} className={tabClasses("general")}>
                                <User size={14} /> Genel Bilgiler
                            </button>
                            <button onClick={() => setDetailTab("orders")} className={tabClasses("orders")}>
                                <FileText size={14} /> Siparişler ({selectedCustomerOrders.length})
                            </button>
                            {canSeeFinancial && (
                                <button onClick={() => setDetailTab("ledger")} className={tabClasses("ledger")}>
                                    <Wallet size={14} /> Tahsilat & Cari ({selectedCustomerPayments.length})
                                </button>
                            )}
                            <button onClick={() => setDetailTab("appointments")} className={tabClasses("appointments")}>
                                <Calendar size={14} /> Randevular ({selectedCustomerAppointments.length})
                            </button>
                            <button onClick={() => setDetailTab("notes")} className={tabClasses("notes")}>
                                <MessageSquare size={14} /> Notlar ({activeCustomerCrmNotes.length})
                            </button>
                            <button onClick={() => setDetailTab("timeline")} className={tabClasses("timeline")}>
                                <Clock size={14} /> Zaman Çizelgesi
                            </button>
                        </div>

                        {/* Tabs Contents */}
                        <div className="flex-1 min-h-[300px]">
                            {/* GENERAL DETAILS TAB */}
                            {detailTab === "general" && (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/60">
                                            <div className="text-xs font-bold text-slate-400">İletişim Bilgileri</div>
                                            <div className="mt-3 space-y-2">
                                                <div>
                                                    <span className="text-xs text-slate-500 block">Telefon</span>
                                                    <span className="text-sm font-bold">{selectedCustomer.phone || "Girilmemiş"}</span>
                                                </div>
                                                <div>
                                                    <span className="text-xs text-slate-500 block">E-posta</span>
                                                    <span className="text-sm font-bold">{selectedCustomer.email || "Girilmemiş"}</span>
                                                </div>
                                                <div>
                                                    <span className="text-xs text-slate-500 block">Kayıt Tarihi</span>
                                                    <span className="text-sm font-bold">{selectedCustomer.created_at ? new Date(selectedCustomer.created_at).toLocaleDateString("tr-TR") : "Belirtilmemiş"}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/60">
                                            <div className="text-xs font-bold text-slate-400">Adres Bilgisi</div>
                                            <div className="mt-3">
                                                <span className="text-xs text-slate-500 block">Açık Adres</span>
                                                <p className="text-sm font-semibold mt-1 leading-relaxed">{selectedCustomer.address || "Adres bilgisi eklenmemiş."}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action Links */}
                                    <div className="flex flex-wrap gap-3">
                                        {selectedCustomer.phone && (
                                            <>
                                                <a href={whatsappUrl(selectedCustomer)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 transition shadow-sm">
                                                    <MessageCircle className="h-4 w-4" /> WhatsApp İletişimi Başlat
                                                </a>
                                                <a href={`tel:${cleanPhone(selectedCustomer.phone)}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                                                    <PhoneCall className="h-4 w-4" /> Telefon ile Ara
                                                </a>
                                            </>
                                        )}
                                        <a href={mapsUrl(selectedCustomer)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                                            <MapPin className="h-4 w-4" /> Haritada Konumu Aç
                                        </a>
                                    </div>
                                </div>
                            )}

                            {/* ORDERS TAB */}
                            {detailTab === "orders" && (
                                <div className="space-y-4">
                                    {selectedCustomerOrders.length === 0 ? (
                                        <div className="text-center py-12 text-slate-500">Müşteriye ait henüz sipariş kaydı bulunmuyor.</div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {selectedCustomerOrders.map(order => {
                                                const orderStatus = order.status || "new_order";
                                                return (
                                                    <div key={order.id} className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 bg-slate-50/50 dark:bg-slate-900/30 flex flex-col justify-between">
                                                        <div>
                                                            <div className="flex justify-between items-start gap-2">
                                                                <div>
                                                                    <span className="text-[10px] text-slate-500 font-extrabold uppercase">Sipariş</span>
                                                                    <div className="font-extrabold text-sm text-slate-800 dark:text-slate-200 mt-0.5">#{order.id.slice(0, 8)}</div>
                                                                </div>
                                                                <span className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800">
                                                                    {orderStatus}
                                                                </span>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                                                                <div>
                                                                    <span className="text-slate-400">Tarih</span>
                                                                    <div className="font-bold mt-0.5">{order.created_at ? new Date(order.created_at).toLocaleDateString("tr-TR") : "—"}</div>
                                                                </div>
                                                                <div>
                                                                    <span className="text-slate-400">Toplam Tutar</span>
                                                                    <div className="font-bold mt-0.5 text-slate-900 dark:text-white">{formatTL(order.total_amount)}</div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex justify-between items-center">
                                                            <button
                                                                onClick={() => {
                                                                    setSelectedCustomerId(null);
                                                                    nav(`/orders/${order.id}`);
                                                                }}
                                                                className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 font-bold hover:underline"
                                                            >
                                                                Sipariş Detayı <ChevronRight size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* COLLECTIONS & LEDGER TAB */}
                            {detailTab === "ledger" && (
                                <div className="space-y-6">
                                    {/* Financial overview tiles */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div className="rounded-2xl bg-slate-50 dark:bg-slate-850 p-4 border border-slate-100 dark:border-slate-800/60">
                                            <div className="text-[10px] font-bold text-slate-500 uppercase">Toplam Satış</div>
                                            <div className="mt-1 text-lg font-black">{formatTL(selectedLedger.totalSales)}</div>
                                        </div>
                                        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 p-4 border border-emerald-100/30 text-emerald-700 dark:text-emerald-400">
                                            <div className="text-[10px] font-bold uppercase">Toplam Tahsilat</div>
                                            <div className="mt-1 text-lg font-black">{formatTL(selectedLedger.totalPaid + selectedLedger.advance)}</div>
                                        </div>
                                        {selectedLedger.balance - selectedLedger.advance < -0.005 ? (
                                            <div className="rounded-2xl bg-sky-50 dark:bg-sky-950/20 p-4 border border-sky-100/30 text-sky-700 dark:text-sky-400">
                                                <div className="text-[10px] font-bold uppercase">Müşteri Avansı</div>
                                                <div className="mt-1 text-lg font-black">{formatTL(selectedLedger.advance - selectedLedger.balance)}</div>
                                            </div>
                                        ) : (
                                            <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/20 p-4 border border-amber-100/30 text-amber-700 dark:text-amber-400">
                                                <div className="text-[10px] font-bold uppercase">Kalan Alacak</div>
                                                <div className="mt-1 text-lg font-black">{formatTL(Math.max(selectedLedger.balance - selectedLedger.advance, 0))}</div>
                                            </div>
                                        )}
                                        <div className="rounded-2xl bg-purple-50 dark:bg-purple-950/20 p-4 border border-purple-100/30 text-purple-700 dark:text-purple-400">
                                            <div className="text-[10px] font-bold uppercase">İşlem Sayısı</div>
                                            <div className="mt-1 text-lg font-black">{selectedLedger.entries.length}</div>
                                        </div>
                                    </div>

                                    {/* Action ledger table */}
                                    <div>
                                        <h3 className="font-extrabold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-1.5"><Wallet size={16} /> Cari Ekstre Hareketleri</h3>
                                        {selectedLedger.entries.length === 0 ? (
                                            <div className="text-center py-12 text-slate-500">Müşteriye ait henüz cari hareket kaydı yok.</div>
                                        ) : (
                                            <div className="space-y-3">
                                                {selectedLedger.entries
                                                    .slice()
                                                    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
                                                    .map((entry) => (
                                                        <div key={entry.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-900/30">
                                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                                <div>
                                                                    <div className="font-black text-sm text-slate-800 dark:text-slate-100">{entry.label}</div>
                                                                    <div className="text-xs text-slate-500 mt-0.5">
                                                                        {entry.date ? new Date(entry.date).toLocaleDateString("tr-TR") : "—"}
                                                                    </div>
                                                                </div>
                                                                <div className="grid grid-cols-3 gap-2 text-[11px] sm:min-w-[360px]">
                                                                    <div className="rounded-lg bg-slate-100/60 dark:bg-slate-800 p-2">
                                                                        <div className="text-slate-500">Borç (Debit)</div>
                                                                        <div className="font-bold text-slate-800 dark:text-slate-100 mt-0.5">{formatTL(entry.debit)}</div>
                                                                    </div>
                                                                    <div className="rounded-lg bg-emerald-100/40 dark:bg-emerald-950/20 p-2 text-emerald-700 dark:text-emerald-450">
                                                                        <div>Alacak (Credit)</div>
                                                                        <div className="font-bold mt-0.5">{formatTL(entry.credit)}</div>
                                                                    </div>
                                                                    <div className="rounded-lg bg-amber-100/40 dark:bg-amber-950/20 p-2 text-amber-700 dark:text-amber-450">
                                                                        <div>Bakiye</div>
                                                                        <div className="font-bold mt-0.5">{formatTL(entry.balance)}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* APPOINTMENTS TAB */}
                            {detailTab === "appointments" && (
                                <div className="space-y-4">
                                    {selectedCustomerAppointments.length === 0 ? (
                                        <div className="text-center py-12 text-slate-500">Müşteriye ait planlanmış bir randevu yok.</div>
                                    ) : (
                                        <div className="space-y-3">
                                            {selectedCustomerAppointments.map(appt => {
                                                const isDone = appt.status === "done" || appt.status === "measured" || appt.status === "completed";
                                                return (
                                                    <div key={appt.id} className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 bg-slate-50/50 dark:bg-slate-900/30 flex justify-between items-center">
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-black text-sm text-slate-800 dark:text-slate-200">{appt.title || (appt.type === "measurement" ? "Ölçü Randevusu" : "Montaj Randevusu")}</span>
                                                                <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                                                    isDone ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                                                                }`}>
                                                                    {appt.status === "planned" ? "Planlandı" : appt.status === "done" ? "Tamamlandı" : appt.status === "measured" ? "Ölçüldü" : appt.status || "Planlandı"}
                                                                </span>
                                                            </div>
                                                            <div className="text-xs text-slate-500 mt-2 space-y-1">
                                                                <div>Randevu Zamanı: <strong className="text-slate-700 dark:text-slate-350">{formatApptDate(appt.start_at)}</strong></div>
                                                                {appt.note && <div>Randevu Notu: <span className="italic">"{appt.note}"</span></div>}
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => {
                                                                setSelectedCustomerId(null);
                                                                nav(`/appointments/${appt.id}`);
                                                            }}
                                                            className="p-2 text-slate-400 hover:text-slate-600 transition"
                                                            title="Detayları İncele"
                                                        >
                                                            <ChevronRight size={20} />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* CRM NOTES TAB */}
                            {detailTab === "notes" && (
                                <div className="space-y-4">
                                    <div className="flex gap-2">
                                        <textarea
                                            rows={2}
                                            className="flex-1 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 bg-transparent text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:outline-none"
                                            placeholder="Tarihli yeni bir CRM notu yazın..."
                                            value={newCrmNote}
                                            onChange={(e) => setNewCrmNote(e.target.value)}
                                        />
                                        <button
                                            onClick={() => addCrmNote(selectedCustomer, newCrmNote)}
                                            className="px-4 rounded-xl bg-slate-900 dark:bg-slate-800 text-white font-bold hover:bg-slate-800 self-end py-3 text-xs shadow-sm whitespace-nowrap"
                                        >
                                            Not Ekle
                                        </button>
                                    </div>

                                    <div className="space-y-3 mt-4">
                                        {activeCustomerCrmNotes.length === 0 ? (
                                            <div className="text-center py-12 text-slate-500 text-sm">CRM not kaydı yok.</div>
                                        ) : (
                                            activeCustomerCrmNotes.map((note) => (
                                                <div key={note.id} className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 bg-slate-50/40 dark:bg-slate-900/10 flex justify-between items-start gap-4">
                                                    <div className="space-y-1">
                                                        <div className="text-[10px] text-slate-400 font-extrabold">{new Date(note.date).toLocaleString("tr-TR")}</div>
                                                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{note.text}</p>
                                                    </div>
                                                    <button
                                                        onClick={() => deleteCrmNote(selectedCustomer, note.id)}
                                                        className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 transition shrink-0"
                                                        title="Notu Sil"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* TIMELINE TAB */}
                            {detailTab === "timeline" && (
                                <div className="space-y-6">
                                    {/* Overall process timeline stepper */}
                                    <div className="mb-6 overflow-x-auto pb-2">
                                        <div className="flex items-center justify-between min-w-[640px] px-4">
                                            {[
                                                { key: "customer", label: "Müşteri" },
                                                { key: "measurement", label: "Ölçü" },
                                                { key: "quote", label: "Teklif" },
                                                { key: "order", label: "Sipariş" },
                                                { key: "payment", label: "Tahsilat" },
                                                { key: "install", label: "Montaj" },
                                                { key: "delivery", label: "Teslim" },
                                            ].map((step, idx, arr) => {
                                                const status = getStepStatus(step.key, selectedCustomer, selectedLedger, selectedCustomerAppointments, selectedCustomerOrders);
                                                const isCompleted = status === "completed";
                                                const isActive = status === "active";

                                                return (
                                                    <div key={step.key} className="flex items-center flex-1 last:flex-none">
                                                        <div className="flex flex-col items-center relative z-10">
                                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-300 ${
                                                                isCompleted ? "bg-emerald-600 text-white" :
                                                                isActive ? "bg-blue-600 text-white animate-pulse ring-4 ring-blue-500/20" :
                                                                "bg-slate-200 dark:bg-slate-800 text-slate-500"
                                                            }`}>
                                                                {isCompleted ? <Check size={14} /> : idx + 1}
                                                            </div>
                                                            <span className={`text-[10px] font-black mt-2 tracking-tight transition-colors ${
                                                                isCompleted ? "text-emerald-600" :
                                                                isActive ? "text-blue-600" :
                                                                "text-slate-500"
                                                            }`}>
                                                                {step.label}
                                                            </span>
                                                        </div>
                                                        {idx < arr.length - 1 && (
                                                            <div className="flex-1 h-0.5 mx-2 relative -top-3.5">
                                                                <div className={`h-full transition-all duration-500 ${
                                                                    isCompleted ? "bg-emerald-600" : "bg-slate-200 dark:bg-slate-850"
                                                                }`} />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Event items list */}
                                    <div className="relative border-l-2 border-slate-100 dark:border-slate-800 pl-6 ml-4 space-y-6">
                                        {timelineItems.length === 0 ? (
                                            <div className="text-center py-6 text-slate-500 text-xs">Zaman çizelgesine ait hareket yok.</div>
                                        ) : (
                                            timelineItems.map((evt: any) => (
                                                <div key={evt.id} className="relative">
                                                    {/* Dot icon */}
                                                    <span className={`absolute -left-[35px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white dark:ring-slate-900 ${evt.iconBg}`}>
                                                        {evt.icon}
                                                    </span>
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="font-extrabold text-sm text-slate-900 dark:text-white leading-none">{evt.title}</h4>
                                                            <span className="text-[10px] text-slate-400 font-bold">{new Date(evt.date).toLocaleString("tr-TR")}</span>
                                                        </div>
                                                        <p className="text-xs text-slate-500 leading-relaxed">{evt.description}</p>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Müşteri Cari Ekstre Modal */}
            {statementCustomer ? (
                <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 backdrop-blur-xs p-0 sm:items-center sm:p-4 animate-fadeIn">
                    <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-t-3xl bg-white dark:bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6 border border-slate-200 dark:border-slate-800">
                        <div className="flex items-start justify-between gap-3 mb-4">
                            <div>
                                <h3 className="flex items-center gap-2 text-lg font-black text-slate-900 dark:text-white">
                                    <FileText className="h-5 w-5 text-primary-600" /> Cari Ekstre
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">{statementCustomer.name || "Müşteri"}</p>
                            </div>
                            <button onClick={() => setStatementCustomer(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Kapat">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Özet kartlar */}
                        <div className="grid grid-cols-3 gap-3 mb-4">
                            <div className="rounded-2xl border border-red-200 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-950/20">
                                <div className="text-[10px] font-bold uppercase text-red-600">Toplam Sipariş</div>
                                <div className="mt-1 text-base font-black text-red-800 dark:text-red-200">{formatTL(statementTotals.salesTotal)}</div>
                            </div>
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                                <div className="text-[10px] font-bold uppercase text-emerald-600">Toplam Tahsilat</div>
                                <div className="mt-1 text-base font-black text-emerald-800 dark:text-emerald-200">{formatTL(statementTotals.paidNet)}</div>
                            </div>
                            <div className={`rounded-2xl border p-3 ${statementTotals.balance < 0 ? "border-sky-200 bg-sky-50 dark:border-sky-900/40 dark:bg-sky-950/20" : "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20"}`}>
                                <div className={`text-[10px] font-bold uppercase ${statementTotals.balance < 0 ? "text-sky-600" : "text-amber-600"}`}>{statementTotals.balance < 0 ? "Müşteri Alacağı" : "Kalan Bakiye"}</div>
                                <div className={`mt-1 text-base font-black ${statementTotals.balance < 0 ? "text-sky-800 dark:text-sky-200" : "text-amber-800 dark:text-amber-200"}`}>{formatTL(Math.abs(statementTotals.balance))}</div>
                            </div>
                        </div>

                        {/* Dışa aktar */}
                        <div className="flex flex-wrap justify-end gap-2 mb-3">
                            <button onClick={exportStatementPDF} disabled={statementRows.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                                <Printer className="h-4 w-4" /> PDF
                            </button>
                            <button onClick={exportStatementCSV} disabled={statementRows.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                                <Download className="h-4 w-4" /> Excel/CSV
                            </button>
                        </div>

                        {/* Hareket tablosu */}
                        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
                            {statementRows.length === 0 ? (
                                <div className="p-8 text-center text-sm text-slate-500">Bu müşteri için hareket bulunamadı.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                                                <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase text-slate-500">Tarih</th>
                                                <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase text-slate-500">Açıklama</th>
                                                <th className="px-3 py-2.5 text-right text-[11px] font-black uppercase text-slate-500">Borç (+)</th>
                                                <th className="px-3 py-2.5 text-right text-[11px] font-black uppercase text-slate-500">Alacak (−)</th>
                                                <th className="px-3 py-2.5 text-right text-[11px] font-black uppercase text-slate-500">Bakiye</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                            {statementRows.map((r) => (
                                                <tr key={r.id} className={`${r.type === "payment" ? "bg-emerald-50/30 dark:bg-emerald-900/10" : r.type === "reversal" ? "bg-red-50/30 dark:bg-red-900/10" : ""}`}>
                                                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-400">{formatStmtDate(r.date)}</td>
                                                    <td className="px-3 py-2.5 font-bold text-slate-800 dark:text-slate-200">{r.label}</td>
                                                    <td className="px-3 py-2.5 text-right font-bold text-red-600">{r.debit > 0 ? `+ ${formatTL(r.debit)}` : <span className="text-slate-300">—</span>}</td>
                                                    <td className="px-3 py-2.5 text-right font-bold text-emerald-600">{r.credit > 0 ? `− ${formatTL(r.credit)}` : <span className="text-slate-300">—</span>}</td>
                                                    <td className={`px-3 py-2.5 text-right font-black ${r.balance > 0 ? "text-red-600 dark:text-red-400" : r.balance < 0 ? "text-sky-600 dark:text-sky-400" : "text-emerald-600 dark:text-emerald-400"}`}>{formatTL(r.balance)}{r.balance < 0 ? " (Alacak)" : ""}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}

            {/* Enhanced Collection Modal */}
            {collectCustomer ? (
                <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 backdrop-blur-xs p-0 sm:items-center sm:p-4 animate-fadeIn">
                    <div className="w-full max-w-md overflow-y-auto rounded-t-3xl bg-white dark:bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6 border border-slate-200 dark:border-slate-800">
                        
                        {collectSuccessState ? (
                            /* Success State Render */
                            <div className="text-center py-4">
                                <div className="mx-auto w-14 h-14 bg-emerald-100 dark:bg-emerald-950/40 rounded-full flex items-center justify-center text-emerald-600 mb-4 animate-bounce">
                                    <Check size={28} />
                                </div>
                                <h3 className="text-lg font-black text-slate-900 dark:text-white mb-1">Tahsilat Kaydedildi</h3>
                                <p className="text-xs text-slate-500 mb-6">{collectCustomer?.name}</p>

                                <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 mb-6 space-y-2.5 text-left border border-slate-100 dark:border-slate-800/60">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Önceki Borç:</span>
                                        <span className="font-bold">{formatTL(collectSuccessState.prevRemaining)}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Tahsil Edilen:</span>
                                        <span className="font-black text-emerald-600">-{formatTL(collectSuccessState.appliedAmount)}</span>
                                    </div>
                                    <div className="border-t border-slate-200 dark:border-slate-700 my-2 pt-2 flex justify-between text-sm">
                                        <span className="text-slate-500 font-bold">Yeni Kalan Borç:</span>
                                        <span className="font-black text-slate-900 dark:text-white">{formatTL(collectSuccessState.newRemaining)}</span>
                                    </div>
                                    {collectSuccessState.overpayment > 0.005 && (
                                        <div className="bg-sky-50 dark:bg-sky-950/30 p-2.5 rounded-lg border border-sky-100 dark:border-sky-900/30 text-xs text-sky-700 dark:text-sky-300 mt-2">
                                            <strong>Müşteri Avansı:</strong> {formatTL(collectSuccessState.overpayment)} tutarında fazla ödeme avans olarak cariye işlendi.
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={() => {
                                        setCollectSuccessState(null);
                                        setCollectCustomer(null);
                                    }}
                                    className="w-full rounded-xl bg-slate-900 dark:bg-slate-800 text-white font-bold py-3 hover:bg-slate-800 dark:hover:bg-slate-700 transition"
                                >
                                    Kapat
                                </button>
                            </div>
                        ) : (
                            /* Entry Form Render */
                            <>
                                <div className="mb-4 flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <h2 className="flex items-center gap-2 text-lg font-black text-slate-900 dark:text-white">
                                            <Wallet className="h-5 w-5 text-emerald-600" /> Tahsilat Yap
                                        </h2>
                                        <p className="mt-1 break-words text-sm text-slate-500">{collectCustomer.name || "Müşteri"}</p>
                                    </div>
                                    <button onClick={() => setCollectCustomer(null)} className="rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs font-bold" disabled={collectSaving}>
                                        Kapat
                                    </button>
                                </div>

                                {collectError ? (
                                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{collectError}</div>
                                ) : null}

                                {/* Financial Preview */}
                                {(() => {
                                    const ledger = ledgerMap[collectCustomer.id] ?? { totalSales: 0, totalPaid: 0, balance: 0, advance: 0, entries: [] };
                                    const netBalance = ledger.balance - ledger.advance;
                                    const displayPaid = ledger.totalPaid + ledger.advance;
                                    const displayRemaining = Math.max(netBalance, 0);

                                    return (
                                        <div className="grid grid-cols-3 gap-2 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl mb-4 border border-slate-100 dark:border-slate-800 text-[10px]">
                                            <div>
                                                <span className="text-slate-400 block font-bold">Toplam Satış</span>
                                                <strong className="text-xs font-black text-slate-800 dark:text-slate-200">{formatTL(ledger.totalSales)}</strong>
                                            </div>
                                            <div>
                                                <span className="text-slate-400 block font-bold">Tahsil Edilen</span>
                                                <strong className="text-xs font-black text-emerald-600">{formatTL(displayPaid)}</strong>
                                            </div>
                                            <div>
                                                <span className="text-slate-400 block font-bold">Kalan Borç</span>
                                                <strong className="text-xs font-black text-rose-600 dark:text-rose-400">{formatTL(displayRemaining)}</strong>
                                            </div>
                                        </div>
                                    );
                                })()}

                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">Tahsilat Tutarı</label>
                                        <input
                                            type="number"
                                            min={0}
                                            inputMode="decimal"
                                            autoFocus
                                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-bold focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
                                            placeholder="0"
                                            value={collectAmount}
                                            onChange={(e) => setCollectAmount(e.target.value)}
                                            disabled={collectSaving}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Tahsilat Tarihi</label>
                                            <input
                                                type="date"
                                                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
                                                value={collectDate}
                                                onChange={(e) => setCollectDate(e.target.value)}
                                                disabled={collectSaving}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">Ödeme Yöntemi</label>
                                            <select
                                                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
                                                value={collectMethod}
                                                onChange={(e) => setCollectMethod(e.target.value)}
                                                disabled={collectSaving}
                                            >
                                                {PAYMENT_METHODS.map((m) => (
                                                    <option key={m.value} value={m.value}>{m.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">Açıklama</label>
                                        <textarea
                                            rows={2}
                                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
                                            placeholder="Tahsilata dair not ekleyin..."
                                            value={collectNote}
                                            onChange={(e) => setCollectNote(e.target.value)}
                                            disabled={collectSaving}
                                        />
                                    </div>

                                    <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-[10px] text-slate-500 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-850">
                                        Tahsilat müşterinin açık siparişlerine en eskiden başlanarak sırayla dağıtılır. Toplam borçtan fazla girilen tutarlar, <strong>Müşteri Avansı</strong> (alacağı) olarak kaydedilir.
                                    </div>

                                    <div className="flex gap-3 pt-2">
                                        <button
                                            onClick={submitCollect}
                                            disabled={collectSaving}
                                            className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-700 disabled:opacity-60 transition text-sm shadow-sm"
                                        >
                                            {collectSaving ? "Kaydediliyor..." : "Tahsilatı Kaydet"}
                                        </button>
                                        <button
                                            onClick={() => setCollectCustomer(null)}
                                            disabled={collectSaving}
                                            className="rounded-xl border border-slate-200 px-4 py-3 font-bold text-slate-700 dark:text-slate-300 dark:border-slate-700 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                                        >
                                            Vazgeç
                                        </button>
                                    </div>
                                </div>
                            </>
                            )}
                        
                    </div>
                </div>
            ) : null}
        </div>
    );
}
