import { useEffect, useState } from "react";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";
import { Edit3, Plus, Save, Search, Trash2, X, ArrowLeft, RefreshCw, PhoneCall, MapPin, MessageCircle } from "lucide-react";
import { normalizeRole, type RoleState } from "../auth/roles";

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
    entries: CustomerLedgerEntry[];
};

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

export default function Customers() {
    const nav = useNavigate();

    const [companyId, setCompanyId] = useState<string>("");
    const [userId, setUserId] = useState<string>("");
    const [role, setRole] = useState<RoleState>("unknown");
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(false);
    const [q, setQ] = useState("");
    const [form, setForm] = useState<CustomerForm>(emptyForm);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<CustomerForm>(emptyForm);
    const [ledgerMap, setLedgerMap] = useState<Record<string, CustomerLedger>>({});
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

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

            let allowedCustomerIds: Set<string> | null = null;
            if (nextRole === "installer") {
                allowedCustomerIds = new Set<string>();

                const [apptRes, orderRes] = await Promise.all([
                    supabase
                        .from("appointments")
                        .select("customer_id, assigned_to, created_by")
                        .eq("company_id", ctx.company_id),
                    supabase
                        .from("orders")
                        .select("customer_id, assigned_to, created_by")
                        .eq("company_id", ctx.company_id),
                ]);

                for (const row of apptRes.data ?? []) {
                    if ((row.assigned_to === ctx.user.id || row.created_by === ctx.user.id) && row.customer_id) {
                        allowedCustomerIds.add(row.customer_id);
                    }
                }
                for (const row of orderRes.data ?? []) {
                    if ((row.assigned_to === ctx.user.id || row.created_by === ctx.user.id) && row.customer_id) {
                        allowedCustomerIds.add(row.customer_id);
                    }
                }
            }

            const { data, error } = await supabase
                .from("customers")
                .select("*")
                .eq("company_id", ctx.company_id)
                .order("created_at", { ascending: false });

            if (error) {
                alert(error.message);
            } else {
                const nextCustomers = ((data as Customer[]) ?? []).filter((customer) => {
                    if (!allowedCustomerIds) return true;
                    return allowedCustomerIds.has(customer.id);
                });
                setCustomers(nextCustomers);
            }

            if (nextRole === "installer") {
                setLedgerMap({});
                return;
            }

            const { data: orders } = await supabase
                .from("orders")
                .select("id, created_at, customer_id, total_amount, paid_amount, remaining_amount, status")
                .eq("company_id", ctx.company_id)
                .not("status", "eq", "draft")
                .not("status", "eq", "cancelled");

            const nextLedger: Record<string, CustomerLedger> = {};
            (orders ?? []).forEach((order: any) => {
                if (!order.customer_id) return;
                const total = Number(order.total_amount ?? 0);
                const paid = Number(order.paid_amount ?? 0);
                const remaining =
                    order.remaining_amount != null ? Number(order.remaining_amount ?? 0) : Math.max(total - paid, 0);
                if (!nextLedger[order.customer_id]) {
                    nextLedger[order.customer_id] = { totalSales: 0, totalPaid: 0, balance: 0, entries: [] };
                }
                nextLedger[order.customer_id].totalSales += total;
                nextLedger[order.customer_id].totalPaid += paid;
                nextLedger[order.customer_id].balance += Math.max(remaining, 0);
                nextLedger[order.customer_id].entries.push({
                    id: `${order.id || order.customer_id}-sale`,
                    date: order.created_at ?? null,
                    label: "Sipariş",
                    debit: total,
                    credit: 0,
                    balance: total,
                });
                if (paid > 0) {
                    nextLedger[order.customer_id].entries.push({
                        id: `${order.id || order.customer_id}-payment`,
                        date: order.created_at ?? null,
                        label: paid >= total ? "Tahsilat" : "Kapora / Tahsilat",
                        debit: 0,
                        credit: paid,
                        balance: Math.max(remaining, 0),
                    });
                }
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
    }, []);

    async function addCustomer() {
        if (!form.name.trim()) {
            alert("Isim bos olamaz");
            return;
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
                alert(retry.error.message);
                return;
            }
        } else if (error) {
            alert(error.message);
            return;
        }

        setForm(emptyForm);
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
            alert("Isim bos olamaz");
            return;
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
            alert(error.message);
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

    const filtered = customers.filter((c) => {
        const s = `${c.name ?? ""} ${c.phone ?? ""} ${c.email ?? ""} ${c.address ?? ""}`.toLowerCase();
        return s.includes(q.toLowerCase());
    });
    const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
    const selectedLedger = selectedCustomerId
        ? ledgerMap[selectedCustomerId] ?? { totalSales: 0, totalPaid: 0, balance: 0, entries: [] }
        : null;
    const canSeeFinancial = role === "admin" || role === "accountant";

    return (
        <div className="space-y-6 pb-24 lg:pb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => nav(-1)}
                        className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 transition shadow-sm"
                        title="Geri Git"
                    >
                        <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold">Müşteriler</h1>
                        <p className="text-slate-500">Müşteri veritabanınızı görüntüleyin ve yönetin.</p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={loadData}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition font-medium"
                    >
                        <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                        Yenile
                    </button>
                    <button
                        onClick={addCustomer}
                        className="px-4 py-3 sm:py-2 bg-primary-600 text-white rounded-lg flex items-center justify-center gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        Kaydet
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                <input className="border rounded-lg px-3 py-2 bg-transparent" placeholder="Ad Soyad *" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
                <input className="border rounded-lg px-3 py-2 bg-transparent" placeholder="Telefon" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                <input className="border rounded-lg px-3 py-2 bg-transparent" placeholder="E-posta" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
                <input className="border rounded-lg px-3 py-2 bg-transparent" placeholder="Adres" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
                <input className="border rounded-lg px-3 py-2 bg-transparent md:col-span-2" placeholder="Not" value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} />
            </div>

            <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="w-full border rounded-lg pl-9 pr-3 py-2 bg-transparent" placeholder="Müşteri ara..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>

            <div className="space-y-3">
                {loading && <div className="text-slate-500">Yükleniyor...</div>}
                {!loading && filtered.length === 0 && <div className="text-slate-500">Kayıt yok.</div>}

                {filtered.map((c) => {
                    const isEditing = editingId === c.id;
                    const ledger = ledgerMap[c.id] ?? { totalSales: 0, totalPaid: 0, balance: 0, entries: [] };

                    return (
                        <div key={c.id} className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-white dark:bg-slate-900">
                            {isEditing ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <input className="border rounded-lg px-3 py-2 bg-transparent" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
                                    <input className="border rounded-lg px-3 py-2 bg-transparent" value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} />
                                    <input className="border rounded-lg px-3 py-2 bg-transparent" value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} />
                                    <input className="border rounded-lg px-3 py-2 bg-transparent" value={editForm.address} onChange={(e) => setEditForm((p) => ({ ...p, address: e.target.value }))} />
                                    <input className="border rounded-lg px-3 py-2 bg-transparent md:col-span-2" value={editForm.note} onChange={(e) => setEditForm((p) => ({ ...p, note: e.target.value }))} />
                                    <div className="md:col-span-2 flex flex-col sm:flex-row gap-2">
                                        <button onClick={updateCustomer} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white">
                                            <Save className="w-4 h-4" /> Kaydet
                                        </button>
                                        <button onClick={() => setEditingId(null)} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border">
                                            <X className="w-4 h-4" /> Vazgec
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                    <button onClick={() => setSelectedCustomerId(c.id)} className="min-w-0 flex-1 text-left">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="font-semibold break-words">{c.name}</div>
                                            {canSeeFinancial ? <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${ledger.balance > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                                                {ledger.balance > 0 ? `Alacak ${formatTL(ledger.balance)}` : "Cari Kapalı"}
                                            </span> : null}
                                        </div>
                                        <div className="text-sm text-slate-500 break-words">
                                            {c.phone ? `Telefon: ${c.phone} ` : ""} {c.email ? ` - E-posta: ${c.email}` : ""}
                                        </div>
                                        {canSeeFinancial ? <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                                            <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                                                <div className="text-slate-500">Satış</div>
                                                <div className="font-bold">{formatTL(ledger.totalSales)}</div>
                                            </div>
                                            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-900/20">
                                                <div>Tahsilat</div>
                                                <div className="font-bold">{formatTL(ledger.totalPaid)}</div>
                                            </div>
                                            <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-900/20">
                                                <div>Kalan</div>
                                                <div className="font-bold">{formatTL(ledger.balance)}</div>
                                            </div>
                                        </div> : null}
                                        <div className="text-sm text-slate-500 break-words">
                                            {c.address ? `Adres: ${c.address}` : ""}
                                        </div>
                                        {c.note ? <div className="text-sm mt-2 break-words">{c.note}</div> : null}
                                        <div className="mt-2 text-xs font-bold text-primary-600">{canSeeFinancial ? "Detay ve işlem geçmişi için dokun" : "Müşteri detayı için dokun"}</div>
                                    </button>
                                    <div className="flex flex-wrap gap-2 shrink-0">
                                        {c.phone ? (
                                            <>
                                                <a href={whatsappUrl(c)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-emerald-200 text-emerald-700 text-sm">
                                                    <MessageCircle className="w-4 h-4" /> WhatsApp
                                                </a>
                                                <a href={`tel:${cleanPhone(c.phone)}`} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm">
                                                    <PhoneCall className="w-4 h-4" /> Ara
                                                </a>
                                            </>
                                        ) : null}
                                        <a href={mapsUrl(c)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm">
                                            <MapPin className="w-4 h-4" /> Konum
                                        </a>
                                        <button onClick={() => startEdit(c)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm">
                                            <Edit3 className="w-4 h-4" /> Düzenle
                                        </button>
                                        <button onClick={() => deleteCustomer(c)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-red-600 text-white text-sm">
                                            <Trash2 className="w-4 h-4" /> Sil
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {selectedCustomer && selectedLedger ? (
                <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
                    <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:rounded-3xl sm:p-6">
                        <div className="mb-5 flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <h2 className="break-words text-xl font-black text-slate-900 dark:text-white">{selectedCustomer.name}</h2>
                                <p className="mt-1 text-sm text-slate-500">{selectedCustomer.phone || "Telefon yok"}</p>
                            </div>
                            <button onClick={() => setSelectedCustomerId(null)} className="rounded-xl border px-3 py-2 text-sm font-bold">
                                Kapat
                            </button>
                        </div>

                        <div className="mb-5 flex flex-wrap gap-2">
                            {selectedCustomer.phone ? (
                                <>
                                    <a href={whatsappUrl(selectedCustomer)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white">
                                        <MessageCircle className="h-4 w-4" /> WhatsApp Gönder
                                    </a>
                                    <a href={`tel:${cleanPhone(selectedCustomer.phone)}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-black">
                                        <PhoneCall className="h-4 w-4" /> Ara
                                    </a>
                                </>
                            ) : null}
                            <a href={mapsUrl(selectedCustomer)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-black">
                                <MapPin className="h-4 w-4" /> Konum Aç
                            </a>
                        </div>

                        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
                                <div className="text-xs font-bold text-slate-500">Toplam Satış</div>
                                <div className="mt-1 text-lg font-black">{formatTL(selectedLedger.totalSales)}</div>
                            </div>
                            <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-700 dark:bg-emerald-900/20">
                                <div className="text-xs font-bold uppercase">Tahsilat</div>
                                <div className="mt-1 text-lg font-black">{formatTL(selectedLedger.totalPaid)}</div>
                            </div>
                            <div className="rounded-2xl bg-amber-50 p-4 text-amber-700 dark:bg-amber-900/20">
                                <div className="text-xs font-bold uppercase">Kalan Alacak</div>
                                <div className="mt-1 text-lg font-black">{formatTL(selectedLedger.balance)}</div>
                            </div>
                        </div>

                        <h3 className="mb-3 font-bold text-slate-900 dark:text-white">İşlem Geçmişi</h3>
                        {selectedLedger.entries.length === 0 ? (
                            <div className="rounded-2xl border border-slate-200 p-6 text-center text-slate-500 dark:border-slate-800">
                                Bu müşteri için cari hareket bulunamadı.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {selectedLedger.entries
                                    .slice()
                                    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
                                    .map((entry) => (
                                        <div key={entry.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <div className="font-bold">{entry.label}</div>
                                                    <div className="text-xs text-slate-500">
                                                        {entry.date ? new Date(entry.date).toLocaleDateString("tr-TR") : "-"}
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2 text-xs sm:min-w-[360px]">
                                                    <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50">
                                                        <div className="text-slate-500">Borç</div>
                                                        <div className="font-black">{formatTL(entry.debit)}</div>
                                                    </div>
                                                    <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
                                                        <div>Tahsilat</div>
                                                        <div className="font-black">{formatTL(entry.credit)}</div>
                                                    </div>
                                                    <div className="rounded-lg bg-amber-50 p-2 text-amber-700">
                                                        <div>Kalan</div>
                                                        <div className="font-black">{formatTL(entry.balance)}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
