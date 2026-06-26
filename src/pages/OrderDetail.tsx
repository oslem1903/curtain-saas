import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { normalizeRole, type RoleState } from "../auth/roles";
import { 
    Plus, 
    Trash2, 
    Phone,
    Image as ImageIcon,
} from "lucide-react";

type ProductType = "plicell" | "stor" | "zebra" | "tul" | "fon" | "jalousie" | "picasso" | "dikey_tul" | "dikey_stor" | "diger";

type OrderRow = {
    id: string;
    created_at: string | null;
    status: string | null;
    note?: string | null;
    total_amount: number | null;
    paid_amount?: number | null;
    deposit_amount?: number | null;
    remaining_amount?: number | null;
    fabric_cost?: number | null;
    mechanism_cost?: number | null;
    installation_cost?: number | null;
    customer_id?: string | null;
    company_id?: string | null;
    assigned_to?: string | null;
    customers?: { name: string; phone: string } | null;
};

type OrderItemRow = {
    id: string;
    product_type: ProductType | null;
    width_cm: number | null;
    height_cm: number | null;
    qty: number | null;
    unit_price: number | null;
    line_total: number | null;
    room: string | null;
    note: string | null;
    calculation_note?: string | null;
    fabric_width_cm?: number | null;
};

type VisualPreviewRow = {
    id: string;
    preview_image_url: string | null;
    original_photo_url: string | null;
    note: string | null;
    selected_catalog_variant_id: string | null;
    catalog_variant?: {
        variant_code: string | null;
        color_name: string | null;
        price_per_m2: number | null;
        texture_image_url: string | null;
        series?: {
            product_type: string | null;
            series_code: string | null;
            model_name: string | null;
        } | Array<{
            product_type: string | null;
            series_code: string | null;
            model_name: string | null;
        }> | null;
    } | Array<{
        variant_code: string | null;
        color_name: string | null;
        price_per_m2: number | null;
        texture_image_url: string | null;
        series?: {
            product_type: string | null;
            series_code: string | null;
            model_name: string | null;
        } | Array<{
            product_type: string | null;
            series_code: string | null;
            model_name: string | null;
        }> | null;
    }> | null;
};

type PaymentRow = {
    id: string;
    payment_date: string | null;
    amount: number | null;
    method: string | null;
    note: string | null;
};

function fmtTL(n?: number | null) {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(Number(n ?? 0));
}

function staffRoleLabel(role: string) {
    if (role === "admin") return "Yönetici";
    if (role === "installer") return "Montajci";
    if (role === "accountant") return "Muhasebe";
    return "Personel";
}

function orderStatusLabel(status?: string | null) {
    const s = String(status ?? "").toLowerCase();
    if (s === "measured") return "Ölçü Alındı";
    if (s === "quoted" || s === "draft") return "Teklif Verildi";
    if (s === "approved") return "Onaylandı";
    if (s === "production") return "İmalatta";
    if (s === "installation_waiting") return "Montaj Bekliyor";
    if (s === "completed") return "Tamamlandı";
    if (s === "paid") return "Ödendi";
    if (s === "partial") return "Kısmi Ödendi";
    if (s === "open") return "Açık";
    return status || "Sipariş";
}

function extractPhotoUrls(note?: string | null) {
    const matches = String(note ?? "").match(/https?:\/\/[^\s)]+/g) ?? [];
    return Array.from(new Set(matches.filter((url) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url))));
}

export default function OrderDetail() {
    const { id } = useParams<{ id: string }>();
    const nav = useNavigate();
    const [order, setOrder] = useState<OrderRow | null>(null);
    const [items, setItems] = useState<OrderItemRow[]>([]);
    const [role, setRole] = useState<RoleState>("unknown");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [staffList, setStaffList] = useState<Array<{ id: string; full_name: string; role: string }>>([]);
    const [assignedTo, setAssignedTo] = useState("");
    const [visualPreviews, setVisualPreviews] = useState<VisualPreviewRow[]>([]);
    const [payments, setPayments] = useState<PaymentRow[]>([]);
    const [showPaymentForm, setShowPaymentForm] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState("");
    const [paymentMethod, setPaymentMethod] = useState("nakit");
    const [paymentNote, setPaymentNote] = useState("");
    const [paymentError, setPaymentError] = useState("");
    const [paymentSuccess, setPaymentSuccess] = useState("");

    // Yeni Ürün Formu State
    const [pType, setPType] = useState<ProductType>("stor");
    const [pWidth, setPWidth] = useState("");
    const [pHeight, setPHeight] = useState("");
    const [pQty] = useState("1");
    const [pPrice, setPPrice] = useState("");
    const [pRoom, setPRoom] = useState("");
    const [pNote, setPNote] = useState("");

    async function loadData() {
        if (!id) return;
        setLoading(true);
        try {
            const { data: o } = await supabase.from("orders").select("*, customers(name, phone)").eq("id", id).single();
            const { data: i } = await supabase.from("order_items").select("*").eq("order_id", id).order("created_at");
            const { data: previews } = await supabase
                .from("visual_previews")
                .select("id, preview_image_url, original_photo_url, note, selected_catalog_variant_id, catalog_variant:catalog_variants(variant_code, color_name, price_per_m2, texture_image_url, series:catalog_series(product_type, series_code, model_name))")
                .eq("order_id", id)
                .order("created_at", { ascending: false });
            const { data: paymentRows } = await supabase
                .from("payments")
                .select("id,payment_date,amount,method,note")
                .eq("order_id", id)
                .order("payment_date", { ascending: false });
            
            setOrder(o);
            setItems(i ?? []);
            setVisualPreviews((previews ?? []) as VisualPreviewRow[]);
            setPayments((paymentRows ?? []) as PaymentRow[]);
            setAssignedTo(o?.assigned_to || "");

            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data: prof } = await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle();
                if (prof) {
                    setRole(normalizeRole(prof.role));
                }

                const { data: companyMember } = await supabase
                    .from("company_members")
                    .select("company_id")
                    .eq("user_id", user.id)
                    .maybeSingle();

                if (companyMember?.company_id) {
                    const { data: members } = await supabase
                        .from("company_members")
                        .select("user_id")
                        .eq("company_id", companyMember.company_id);

                    const { data: employees } = await supabase
                        .from("employees")
                        .select("id,user_id,full_name,target_role,is_active")
                        .eq("company_id", companyMember.company_id)
                        .eq("is_active", true)
                        .order("full_name");

                    const userIds = (members ?? []).map((m) => m.user_id).filter(Boolean);
                    const employeeUserIds = (employees ?? []).map((employee: any) => employee.user_id).filter(Boolean);
                    const allUserIds = Array.from(new Set([...userIds, ...employeeUserIds]));
                    if (allUserIds.length > 0 || (employees ?? []).length > 0) {
                        let profiles: any[] = [];
                        if (allUserIds.length > 0) {
                            const profileRes = await supabase
                                .from("profiles")
                                .select("user_id, full_name, role")
                                .in("user_id", allUserIds)
                                .order("full_name");
                            profiles = profileRes.data ?? [];
                        }

                        const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
                        const mergedStaff = new Map<string, { id: string; full_name: string; role: string }>();

                        (profiles ?? []).forEach((item) => {
                            mergedStaff.set(item.user_id, {
                                id: item.user_id,
                                full_name: item.full_name || "İsimsiz",
                                role: item.role || "installer",
                            });
                        });

                        (employees ?? []).forEach((employee: any) => {
                            const staffId = employee.user_id || employee.id;
                            const profile = employee.user_id ? profileById.get(employee.user_id) : null;
                            mergedStaff.set(staffId, {
                                id: staffId,
                                full_name: employee.full_name || profile?.full_name || "İsimsiz",
                                role: profile?.role || employee.target_role || "installer",
                            });
                        });

                        setStaffList(Array.from(mergedStaff.values()).sort((a, b) => a.full_name.localeCompare(b.full_name, "tr")));
                    }
                }
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }

    useEffect(() => {
        loadData();
        // `loadData` is intentionally excluded to prevent unnecessary reruns.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    async function handleAddItem() {
        if (!id || !order) return;
        setSaving(true);
        const w = Number(pWidth), h = Number(pHeight), q = Number(pQty), u = Number(pPrice);
        const area = (w > 0 && h > 0) ? (w / 100) * (h / 100) : 1;
        const total = Math.max(area, 1) * u * q;

        await supabase.from("order_items").insert({
            order_id: id, product_type: pType, width_cm: w, height_cm: h, qty: q, unit_price: u, line_total: total, room: pRoom, note: pNote
        });
        
        // Sipariş toplamını güncelle
        const newTotal = items.reduce((s, x) => s + Number(x.line_total || 0), 0) + total;
        await supabase.from("orders").update({ total_amount: newTotal }).eq("id", id);
        
        setPWidth(""); setPHeight(""); setPPrice(""); setPRoom(""); setPNote("");
        setSaving(false);
        loadData();
    }

    async function handleDeleteItem(itemId: string) {
        if (!window.confirm("Silinsin mi?")) return;
        await supabase.from("order_items").delete().eq("id", itemId);
        loadData();
    }

    async function handleUpdateAssignedTo() {
        if (!id) return;
        setSaving(true);
        const { error } = await supabase.from("orders").update({ assigned_to: assignedTo || null }).eq("id", id);
        setSaving(false);
        if (error) {
            alert(error.message);
            return;
        }
        await loadData();
    }

    async function handleAddPayment() {
        if (!id || !order) return;
        const amount = Number(paymentAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            setPaymentError("Tahsilat tutarı 0'dan büyük olmalı.");
            return;
        }

        setSaving(true);
        setPaymentError("");
        setPaymentSuccess("");
        try {
            const currentPaid = Number(order.paid_amount ?? order.deposit_amount ?? 0);
            const orderTotal = Number(order.total_amount ?? salesTotal ?? 0);
            const nextPaid = currentPaid + amount;
            const nextRemaining = Math.max(orderTotal - nextPaid, 0);
            const overpayment = Math.max(nextPaid - orderTotal, 0);
            const nextStatus = nextRemaining <= 0 ? "paid" : nextPaid > 0 ? "partial" : "open";
            const nowIso = new Date().toISOString();
            const overNote = overpayment > 0 ? ` Fazla tahsilat / müşteri alacağı: ${fmtTL(overpayment)}.` : "";

            const paymentRes = await supabase.from("payments").insert({
                company_id: order.company_id,
                order_id: id,
                payment_date: nowIso,
                amount,
                method: paymentMethod || null,
                note: `${paymentNote || "Sipariş tahsilatı"}.${overNote}`.trim(),
            });
            if (paymentRes.error) throw paymentRes.error;

            const incomeRes = await supabase.from("income").insert({
                company_id: order.company_id,
                income_date: nowIso,
                amount,
                payment_method: paymentMethod || null,
                description: `Sipariş tahsilatı - ${order.customers?.name || "Müşteri"}`,
                note: paymentNote || (overpayment > 0 ? `Fazla tahsilat: ${fmtTL(overpayment)}` : null),
                source: "order_payment",
                order_id: id,
            });
            if (incomeRes.error) throw incomeRes.error;

            const updateRes = await supabase
                .from("orders")
                .update({
                    paid_amount: nextPaid,
                    remaining_amount: nextRemaining,
                    status: nextStatus,
                    note: overpayment > 0
                        ? [order.note, `Fazla tahsilat / müşteri alacağı: ${fmtTL(overpayment)}`].filter(Boolean).join("\n")
                        : order.note,
                })
                .eq("id", id);
            if (updateRes.error) throw updateRes.error;

            setPaymentAmount("");
            setPaymentNote("");
            setShowPaymentForm(false);
            setPaymentSuccess(overpayment > 0 ? `Ödeme kaydedildi. Müşteri alacaklı: ${fmtTL(overpayment)}` : "Ödeme kaydedildi.");
            await loadData();
        } catch (e: any) {
            setPaymentError(e?.message ?? "Ödeme kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="p-10 text-center font-bold">Yükleniyor...</div>;
    if (!order) return <div className="p-10 ">Sipariş bulunamadı.</div>;

    const salesTotal = items.reduce((s, x) => s + Number(x.line_total || 0), 0);
    const paid = Number(order.paid_amount ?? order.deposit_amount ?? 0);
    const remaining = Math.max(salesTotal - paid, 0);
    const overpayment = Math.max(paid - salesTotal, 0);
    const orderPhotoUrls = extractPhotoUrls(order.note);

    return (
        <div className="max-w-6xl mx-auto space-y-6 pb-24 px-4">
            {/* Header / Üst Kart */}
            <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 p-8 shadow-sm">
                <div className="flex flex-col md:flex-row justify-between items-start gap-6">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 text-primary-600 mb-2">
                            <span className="px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-[10px] font-black tracking-widest uppercase text-emerald-700 dark:text-emerald-300">
                                {orderStatusLabel(order.status)}
                            </span>
                            <span className="px-3 py-1 rounded-full bg-primary-50 dark:bg-primary-900/20 text-[10px] font-black tracking-widest uppercase">
                                {order.status === 'draft' ? 'TEKLİF / ÖLÇÜ' : 'SİPARİŞ'}
                            </span>
                            <span className="text-xs text-slate-400 font-bold">#{order.id.slice(0,8)}</span>
                        </div>
                        <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">
                            {order.customers?.name || "İsimsiz Müşteri"}
                        </h1>
                        <div className="mt-4 flex flex-wrap gap-4">
                            <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
                                <Phone className="w-4 h-4" /> {order.customers?.phone || "-"}
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-3xl p-6 min-w-[240px] text-right">
                        <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">Sipariş Toplamı</div>
                        <div className="text-3xl font-black text-primary-600 tracking-tighter">{fmtTL(salesTotal)}</div>
                    </div>
                </div>

                {(role === "admin" || role === "accountant") && (
                    <div className="mt-6 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
                            <div>
                                <div className="text-xs text-slate-400 font-black uppercase tracking-widest">Atanan Personel</div>
                                <div className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">
                                    {staffList.find((staff) => staff.id === order.assigned_to)
                                        ? `${staffList.find((staff) => staff.id === order.assigned_to)?.full_name} (${staffRoleLabel(staffList.find((staff) => staff.id === order.assigned_to)?.role || "installer")})`
                                        : "Henüz personel atanmadı"}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => nav("/staff")}
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary-200 bg-white px-4 py-2 text-sm font-black text-primary-700 hover:bg-primary-50 dark:border-primary-900 dark:bg-slate-900 dark:text-primary-300"
                            >
                                <Plus className="w-4 h-4" />
                                Yeni Personel Ekle
                            </button>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <select
                                value={assignedTo}
                                onChange={(e) => setAssignedTo(e.target.value)}
                                className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3"
                            >
                                <option value="">Personel seç / atamayı kaldır</option>
                                {staffList.map((staff) => (
                                    <option key={staff.id} value={staff.id}>
                                        {staff.full_name} ({staffRoleLabel(staff.role)})
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={handleUpdateAssignedTo}
                                disabled={saving || assignedTo === (order.assigned_to || "")}
                                className="px-5 py-3 rounded-xl bg-primary-600 text-white font-bold disabled:opacity-60"
                            >
                                {saving ? "Kaydediliyor..." : order.assigned_to ? "Personeli Değiştir" : "Personeli Ata"}
                            </button>
                        </div>
                        {staffList.length === 0 ? (
                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                                Henüz personel kartı yok. Yeni Personel Ekle ile montajcı/personel kartı oluşturabilirsiniz.
                            </div>
                        ) : null}
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 pt-6 border-t border-slate-50 dark:border-slate-800">
                    <div className="p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100/50">
                        <div className="text-[10px] text-emerald-600 font-black mb-1">TAHSİLAT</div>
                        <div className="text-xl font-black text-emerald-700">{fmtTL(paid)}</div>
                    </div>
                    <div className="p-4 rounded-2xl bg-rose-50/50 dark:bg-rose-900/10 border border-rose-100/50">
                        <div className="text-[10px] text-rose-600 font-black mb-1">KALAN</div>
                        <div className="text-xl font-black text-rose-700">{fmtTL(remaining)}</div>
                    </div>
                    {overpayment > 0 ? (
                        <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-900/10 border border-blue-100">
                            <div className="text-[10px] text-blue-600 font-black mb-1">MÜŞTERİ ALACAKLI</div>
                            <div className="text-xl font-black text-blue-700">{fmtTL(overpayment)}</div>
                        </div>
                    ) : null}
                    {(role === 'admin' || role === 'accountant') && (
                        <button type="button" onClick={() => setShowPaymentForm((value) => !value)} className="bg-emerald-600 hover:bg-emerald-700 text-white p-4 rounded-2xl font-black shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2">
                             + Ödeme Ekle
                        </button>
                    )}
                </div>

                {paymentError ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{paymentError}</div> : null}
                {paymentSuccess ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{paymentSuccess}</div> : null}

                {showPaymentForm ? (
                    <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-900/10">
                        <div className="grid gap-3 sm:grid-cols-[1fr_160px_1fr_auto]">
                            <input type="number" min={0} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="min-h-12 rounded-xl border border-emerald-200 bg-white px-4 font-bold outline-none dark:border-emerald-900 dark:bg-slate-900" placeholder="Tahsilat tutarı" />
                            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="min-h-12 rounded-xl border border-emerald-200 bg-white px-4 font-bold outline-none dark:border-emerald-900 dark:bg-slate-900">
                                <option value="nakit">Nakit</option>
                                <option value="kart">Kart</option>
                                <option value="havale">Havale/EFT</option>
                                <option value="diger">Diğer</option>
                            </select>
                            <input value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} className="min-h-12 rounded-xl border border-emerald-200 bg-white px-4 font-bold outline-none dark:border-emerald-900 dark:bg-slate-900" placeholder="Açıklama" />
                            <button type="button" onClick={handleAddPayment} disabled={saving} className="min-h-12 rounded-xl bg-emerald-600 px-5 font-black text-white disabled:opacity-60">
                                Kaydet
                            </button>
                        </div>
                    </div>
                ) : null}

                {payments.length > 0 ? (
                    <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        <div className="text-xs font-black uppercase tracking-widest text-slate-400">Tahsilat Geçmişi</div>
                        <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                            {payments.map((payment) => (
                                <div key={payment.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <div className="font-black">{fmtTL(payment.amount)}</div>
                                        <div className="text-xs text-slate-500">{payment.method || "Ödeme"} - {payment.note || "Açıklama yok"}</div>
                                    </div>
                                    <div className="text-xs font-bold text-slate-500">{payment.payment_date ? new Date(payment.payment_date).toLocaleDateString("tr-TR") : "-"}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Sol: Ürün Listesi ve Ekleme */}
                <div className="lg:col-span-8 space-y-6">
                    {/* Ürün Ekleme Formu (DRAFT ise veya admin ise) */}
                    {(order.status === 'draft' || role === 'admin') && (
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border-2 border-primary-100 dark:border-primary-900/30 p-6">
                            <h2 className="text-lg font-black mb-4 flex items-center gap-2 text-slate-900 dark:text-white uppercase tracking-tighter">
                                <Plus className="w-5 h-5 text-primary-600" /> Yeni Ölçü / Ürün Ekle
                            </h2>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <select value={pType} onChange={e => setPType(e.target.value as any)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold">
                                    <option value="plicell">Plicell</option>
                                    <option value="stor">Stor</option>
                                    <option value="zebra">Zebra</option>
                                    <option value="tul">Tül</option>
                                    <option value="fon">Fon</option>
                                    <option value="jalousie">Jaluzi</option>
                                    <option value="dikey_tul">Dikey Tül</option>
                                    <option value="dikey_stor">Dikey Stor</option>
                                    <option value="picasso">Picasso</option>
                                    <option value="diger">Diğer</option>
                                </select>
                                <input placeholder="En (cm)" value={pWidth} onChange={e => setPWidth(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                                <input placeholder="Boy (cm)" value={pHeight} onChange={e => setPHeight(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                                <input placeholder="Birim Fiyat" value={pPrice} onChange={e => setPPrice(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                            </div>
                            <div className="grid grid-cols-2 gap-3 mt-3">
                                <input placeholder="Oda (Mutfak, Salon...)" value={pRoom} onChange={e => setPRoom(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                                <input placeholder="Ürün Notu" value={pNote} onChange={e => setPNote(e.target.value)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-sm font-bold" />
                            </div>
                            <button onClick={handleAddItem} disabled={saving} className="w-full mt-4 bg-primary-600 hover:bg-primary-700 text-white p-4 rounded-2xl font-black shadow-lg">
                                {saving ? "Kaydediliyor..." : "SATIRA EKLE"}
                            </button>
                        </div>
                    )}

                    {/* Ürün Tablosu */}
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex justify-between items-center">
                            <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">🛒 Ürün Listesi</h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-slate-50/50 dark:bg-slate-800/30 text-[10px] text-slate-400 font-black uppercase tracking-widest">
                                        <th className="px-6 py-4">Ürün & Konum</th>
                                        <th className="px-6 py-4 text-center">Ölçü</th>
                                        <th className="px-6 py-4 text-center">Adet</th>
                                        <th className="px-6 py-4 text-right">Tutar</th>
                                        <th className="px-6 py-4 text-right"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                    {items.map(it => (
                                        <tr key={it.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-all">
                                            <td className="px-6 py-5">
                                                <div className="font-black text-slate-900 dark:text-white uppercase text-sm">{it.product_type}</div>
                                                <div className="text-[10px] text-slate-400 font-bold uppercase">{it.room || "Standart"}</div>
                                                {it.calculation_note ? <div className="mt-1 text-[11px] text-slate-500">{it.calculation_note}</div> : null}
                                                {it.fabric_width_cm ? <div className="mt-1 text-[11px] font-bold text-primary-600">{it.fabric_width_cm} cm kumaş</div> : null}
                                            </td>
                                            <td className="px-6 py-5 text-center font-mono text-xs">{it.width_cm}x{it.height_cm}</td>
                                            <td className="px-6 py-5 text-center font-black text-slate-600">x{it.qty}</td>
                                            <td className="px-6 py-5 text-right font-black text-slate-900 dark:text-white">{fmtTL(it.line_total)}</td>
                                            <td className="px-6 py-5 text-right">
                                                {order.status === 'draft' && (
                                                    <button onClick={() => handleDeleteItem(it.id)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Sağ: Maliyet & Notlar */}
                <div className="lg:col-span-4 space-y-6">
                    {visualPreviews.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-6">
                            <h2 className="text-xl font-black mb-4 uppercase tracking-tighter flex items-center gap-2">
                                <ImageIcon className="w-5 h-5 text-primary-600" />
                                Seçilen Kartela
                            </h2>
                            <div className="space-y-4">
                                {visualPreviews.map((preview) => {
                                    const variant = Array.isArray(preview.catalog_variant) ? preview.catalog_variant[0] : preview.catalog_variant;
                                    const series = Array.isArray(variant?.series) ? variant?.series[0] : variant?.series;
                                    return (
                                        <div key={preview.id} className="rounded-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
                                            {preview.preview_image_url ? (
                                                <img src={preview.preview_image_url} alt="Önizleme Görseli" className="h-48 w-full object-cover" />
                                            ) : null}
                                            <div className="p-4 text-sm">
                                                <div className="font-black text-slate-900 dark:text-white">
                                                    {series?.series_code || "-"} {series?.model_name || ""} {variant?.variant_code || ""}
                                                </div>
                                                <div className="mt-1 text-slate-500">Müşteri Seçimi: {variant?.color_name || "-"} / {series?.product_type || "-"}</div>
                                                {variant?.texture_image_url ? <div className="mt-1 text-slate-500 break-all">Texture: {variant.texture_image_url}</div> : null}
                                                <div className="mt-2 font-bold text-primary-600">{fmtTL(variant?.price_per_m2)} / m²</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {orderPhotoUrls.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-6">
                            <h2 className="text-xl font-black mb-4 uppercase tracking-tighter flex items-center gap-2">
                                <ImageIcon className="w-5 h-5 text-primary-600" />
                                Ölçü Fotoğrafları
                            </h2>
                            <div className="grid grid-cols-2 gap-3">
                                {orderPhotoUrls.map((url) => (
                                    <a key={url} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-slate-100 dark:border-slate-800">
                                        <img src={url} alt="Ölçü fotoğrafı" className="h-32 w-full object-cover" />
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Maliyet Kutusu (Sadece Admin/Muhasebe) */}
                    {(role === 'admin' || role === 'accountant') && (
                        <div className="bg-slate-900 text-white rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                             <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl -mr-16 -mt-16"></div>
                             <h2 className="text-lg font-black mb-6 text-primary-400 uppercase tracking-tighter">🚨 Kar Analizi</h2>
                             <div className="space-y-4">
                                <div className="flex justify-between text-sm opacity-60"><span>Kumaş</span> <span>{fmtTL(order.fabric_cost)}</span></div>
                                <div className="flex justify-between text-sm opacity-60"><span>Mekanizma</span> <span>{fmtTL(order.mechanism_cost)}</span></div>
                                <div className="flex justify-between text-sm opacity-60"><span>Montaj</span> <span>{fmtTL(order.installation_cost)}</span></div>
                                <div className="pt-4 border-t border-white/5 text-center">
                                    <div className="text-[10px] font-black text-emerald-400 mb-1">PROJE KARI</div>
                                    <div className="text-3xl font-black text-white">{fmtTL(salesTotal - (Number(order.fabric_cost)+Number(order.mechanism_cost)+Number(order.installation_cost)))}</div>
                                </div>
                             </div>
                        </div>
                    )}

                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-8">
                        <h2 className="text-xl font-black mb-4 uppercase tracking-tighter">📝 Sipariş Notu</h2>
                        <div className="text-sm text-slate-500 font-medium leading-relaxed bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl min-h-[100px]">
                            {order.note || "Herhangi bir özel not eklenmemiş."}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
