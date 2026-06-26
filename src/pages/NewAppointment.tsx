import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { normalizeRole, type RoleState } from "../auth/roles";
import { useRole } from "../context/RoleContext";
import {
    Calendar,
    CheckCircle2,
    ClipboardList,
    Clock,
    MapPin,
    PackagePlus,
    Search,
    User,
    UserPlus,
} from "lucide-react";

type Customer = {
    id: string;
    name: string | null;
    phone: string | null;
    address: string | null;
};

type StaffMember = {
    id: string;
    full_name: string;
    role: string;
};

type CustomerMode = "existing" | "new";

async function getContext() {
    return getEffectiveTenantContext();
}

function roleText(role: string) {
    if (role === "installer" || role === "measurement") return "Montaj Personeli";
    if (role === "accountant") return "Muhasebe";
    if (role === "admin") return "Yönetici";
    return role || "Personel";
}

export default function NewAppointment() {
    const nav = useNavigate();
    const { effectiveRole, realRole, viewingUserId } = useRole();
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");

    const [companyId, setCompanyId] = useState("");
    const [userId, setUserId] = useState("");
    const [role, setRole] = useState<RoleState>("unknown");
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [staffList, setStaffList] = useState<StaffMember[]>([]);

    const [customerMode, setCustomerMode] = useState<CustomerMode>("existing");
    const [customerSearch, setCustomerSearch] = useState("");
    const [customerId, setCustomerId] = useState("");
    const [customerName, setCustomerName] = useState("");
    const [phone, setPhone] = useState("");
    const [address, setAddress] = useState("");
    const [productRequest, setProductRequest] = useState("");
    const [date, setDate] = useState("");
    const [time, setTime] = useState("");
    const [assignedTo, setAssignedTo] = useState("");
    const [note, setNote] = useState("");
    const [type, setType] = useState("measurement");
    const dateInputRef = useRef<HTMLInputElement | null>(null);
    const timeInputRef = useRef<HTMLInputElement | null>(null);
    const assignedSelectRef = useRef<HTMLSelectElement | null>(null);

    useEffect(() => {
        async function load() {
            setLoading(true);
            try {
                const ctx = await getContext();
                setCompanyId(ctx.company_id);
                setUserId(ctx.user.id);

                const [custRes, memberRes, employeeRes, profileRes] = await Promise.all([
                    supabase
                        .from("customers")
                        .select("id, name, phone, address")
                        .eq("company_id", ctx.company_id)
                        .order("name"),
                    supabase.from("company_members").select("user_id").eq("company_id", ctx.company_id),
                    supabase
                        .from("employees")
                        .select("user_id, full_name, target_role, is_active")
                        .eq("company_id", ctx.company_id)
                        .eq("is_active", true)
                        .order("full_name"),
                    supabase.from("profiles").select("role").eq("user_id", ctx.user.id).maybeSingle(),
                ]);

                if (custRes.error) throw custRes.error;
                if (memberRes.error) throw memberRes.error;
                if (employeeRes.error) throw employeeRes.error;
                if (profileRes.error) throw profileRes.error;

                const nextRole = realRole === "super_admin" ? effectiveRole : normalizeRole(profileRes.data?.role);
                setRole(nextRole);
                if (nextRole === "installer" || nextRole === "measurement") {
                    setAssignedTo(viewingUserId || ctx.user.id);
                }
                setCustomers((custRes.data as Customer[]) ?? []);
                const employeeRows = (employeeRes.data ?? []).filter((employee: any) => Boolean(employee.user_id));
                const employeeUserIds = employeeRows.map((employee: any) => employee.user_id).filter(Boolean);
                const memberUserIds = (memberRes.data ?? []).map((m) => m.user_id).filter(Boolean);
                const userIds = Array.from(new Set(employeeUserIds.length > 0 ? employeeUserIds : memberUserIds));
                if (userIds.length === 0) {
                    setStaffList([]);
                    return;
                }

                const { data: staffRes, error: staffErr } = await supabase
                    .from("profiles")
                    .select("user_id, full_name, role")
                    .in("user_id", userIds)
                    .order("full_name");

                if (staffErr) throw staffErr;
                const profileById = new Map((staffRes ?? []).map((profile) => [profile.user_id, profile]));
                const staffRows = employeeRows.length > 0
                    ? employeeRows.map((employee: any) => {
                          const profile = profileById.get(employee.user_id);
                          return {
                              user_id: employee.user_id,
                              full_name: employee.full_name || profile?.full_name || "İsimsiz",
                              role: profile?.role || employee.target_role || "installer",
                          };
                      })
                    : (staffRes ?? []);
                setStaffList(
                    staffRows
                        .filter((s) => {
                            const staffRole = normalizeRole(s.role);
                            return staffRole === "installer" || staffRole === "measurement";
                        })
                        .map((s) => ({
                            id: s.user_id,
                            full_name: s.full_name || "İsimsiz",
                            role: s.role || "installer",
                        })),
                );
            } catch (e: any) {
                setErr(e.message);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [effectiveRole, realRole, viewingUserId]);

    const filteredCustomers = useMemo(() => {
        const q = customerSearch.trim().toLowerCase();
        if (!q) return customers.slice(0, 8);

        return customers
            .filter((c) => {
                const haystack = `${c.name ?? ""} ${c.phone ?? ""} ${c.address ?? ""}`.toLowerCase();
                return haystack.includes(q);
            })
            .slice(0, 8);
    }, [customerSearch, customers]);

    const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

    function switchMode(mode: CustomerMode) {
        setCustomerMode(mode);
        setErr("");
        setCustomerSearch("");
        setCustomerId("");
        setCustomerName("");
        setPhone("");
        setAddress("");
    }

    function selectCustomer(customer: Customer) {
        setCustomerId(customer.id);
        setCustomerName(customer.name ?? "");
        setCustomerSearch(customer.name ?? "");
        setPhone(customer.phone ?? "");
        setAddress(customer.address ?? "");
    }

    function buildNote() {
        const parts = [];
        if (productRequest.trim()) parts.push(`Ürün / talep: ${productRequest.trim()}`);
        if (note.trim()) parts.push(`Not: ${note.trim()}`);
        return parts.join("\n");
    }

    async function handleSave() {
        const nameForNewCustomer = customerName.trim();

        if (customerMode === "existing" && !customerId) {
            setErr("Lütfen mevcut müşteriyi listeden seçin veya 'Yeni müşteri' moduna geçin.");
            return;
        }

        if (customerMode === "new" && !nameForNewCustomer) {
            setErr("Yeni müşteri için ad soyad zorunludur.");
            return;
        }

        const finalDate = date || dateInputRef.current?.value || "";
        const finalTime = time || timeInputRef.current?.value || "";
        const finalAssignedTo = assignedTo || assignedSelectRef.current?.value || "";

        if (!finalDate || !finalTime) {
            setErr("Lütfen tarih ve saat alanlarını doldurun.");
            return;
        }

        setLoading(true);
        setErr("");

        try {
            let finalCustomerId = customerId;

            if (customerMode === "new") {
                const { data: newCust, error: cErr } = await supabase
                    .from("customers")
                    .insert([
                        {
                            company_id: companyId,
                            name: nameForNewCustomer,
                            phone: phone.trim() || null,
                            address: address.trim() || null,
                            created_by: userId || null,
                        },
                    ])
                    .select("id")
                    .single();

                if (cErr && String(cErr.message || "").toLowerCase().includes("created_by")) {
                    const retry = await supabase
                        .from("customers")
                        .insert([
                            {
                                company_id: companyId,
                                name: nameForNewCustomer,
                                phone: phone.trim() || null,
                                address: address.trim() || null,
                            },
                        ])
                        .select("id")
                        .single();
                    if (retry.error) throw retry.error;
                    finalCustomerId = retry.data.id;
                } else {
                    if (cErr) throw cErr;
                    finalCustomerId = newCust.id;
                }
            }

            const startAt = new Date(`${finalDate}T${finalTime}:00`).toISOString();
            const appointmentNote = buildNote();
            const title =
                type === "measurement"
                    ? "Ölçü Randevusu"
                    : type === "installation"
                      ? "Montaj Randevusu"
                      : "Randevu";

            const assignedUserId = role === "installer" || role === "measurement" ? (viewingUserId || userId) : (finalAssignedTo || null);
            const appointmentPayload = {
                    company_id: companyId,
                    customer_id: finalCustomerId,
                    type,
                    title,
                    address: address.trim() || null,
                    start_at: startAt,
                    scheduled_at: startAt,
                    assigned_to: assignedUserId,
                    assigned_user_id: assignedUserId,
                    assigned_role: role === "measurement" ? "measurement" : assignedUserId ? "installer" : null,
                    created_by: userId || null,
                    note: appointmentNote || null,
                    status: "planned",
            };

            let { error: apptErr } = await supabase.from("appointments").insert([appointmentPayload]);

            if (apptErr) {
                const message = String(apptErr.message || "").toLowerCase();
                const fallbackPayload: any = { ...appointmentPayload };
                if (message.includes("created_by")) delete fallbackPayload.created_by;
                if (message.includes("assigned_user_id")) delete fallbackPayload.assigned_user_id;
                if (message.includes("assigned_role")) delete fallbackPayload.assigned_role;
                const retry = await supabase.from("appointments").insert([fallbackPayload]);
                apptErr = retry.error;
            }

            if (apptErr) throw apptErr;

            if (assignedUserId && assignedUserId !== (viewingUserId || userId)) {
                const dateObj = new Date(startAt);
                const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()} ${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
                
                // Müşteri adını doğru yakalayalım
                const displayCustomerName = customerMode === "new" ? nameForNewCustomer : customerName;
                
                await supabase.from("notifications").insert([{
                    user_id: assignedUserId,
                    title: "Yeni Görev Atandı",
                    message: `Size yeni bir ${title} atandı. Tarih: ${dateStr}. Müşteri: ${displayCustomerName || "Bilinmiyor"}`,
                    type: "info"
                }]);
            }

            nav("/dashboard", { state: { refresh: true } });
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="max-w-3xl mx-auto p-4 sm:p-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-primary-100 dark:bg-primary-900/30 text-primary-600 rounded-2xl">
                    <Calendar className="w-6 h-6" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Yeni Randevu Oluştur</h1>
                    <p className="text-slate-500 text-sm">
                        Mevcut müşteriye yeni ürün talebi açabilir veya yeni müşteri kaydedebilirsiniz.
                    </p>
                </div>
            </div>

            {err && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-xl border border-red-200">{err}</div>}

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-8 shadow-sm space-y-6">
                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
                    <button
                        type="button"
                        onClick={() => switchMode("existing")}
                        className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-black transition ${
                            customerMode === "existing"
                                ? "bg-white dark:bg-slate-950 text-primary-700 shadow-sm"
                                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        }`}
                    >
                        <User className="w-4 h-4" />
                        Mevcut Müşteri
                    </button>
                    <button
                        type="button"
                        onClick={() => switchMode("new")}
                        className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-black transition ${
                            customerMode === "new"
                                ? "bg-white dark:bg-slate-950 text-primary-700 shadow-sm"
                                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        }`}
                    >
                        <UserPlus className="w-4 h-4" />
                        Yeni Müşteri
                    </button>
                </div>

                {customerMode === "existing" ? (
                    <div className="space-y-3">
                        <label className="text-sm font-semibold flex items-center gap-2">
                            <Search className="w-4 h-4" /> Müşteri ara ve seç *
                        </label>
                        <input
                            className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                            value={customerSearch}
                            onChange={(e) => {
                                setCustomerSearch(e.target.value);
                                setCustomerId("");
                                setCustomerName("");
                            }}
                            placeholder="Ad, telefon veya adres ile ara..."
                        />

                        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                            {filteredCustomers.length === 0 ? (
                                <div className="p-4 text-sm text-slate-500">
                                    Müşteri bulunamadı. Yeni müşteri moduna geçerek kayıt açabilirsiniz.
                                </div>
                            ) : (
                                filteredCustomers.map((customer) => (
                                    <button
                                        key={customer.id}
                                        type="button"
                                        onClick={() => selectCustomer(customer)}
                                        className={`w-full text-left p-4 border-b last:border-b-0 border-slate-100 dark:border-slate-800 transition ${
                                            customer.id === customerId
                                                ? "bg-primary-50 dark:bg-primary-900/20"
                                                : "hover:bg-slate-50 dark:hover:bg-slate-800/70"
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="font-black text-slate-900 dark:text-white">
                                                    {customer.name || "İsimsiz müşteri"}
                                                </div>
                                                <div className="text-sm text-slate-500">
                                                    {[customer.phone, customer.address].filter(Boolean).join(" - ") ||
                                                        "Telefon/adres yok"}
                                                </div>
                                            </div>
                                            {customer.id === customerId && (
                                                <CheckCircle2 className="w-5 h-5 text-primary-600 shrink-0" />
                                            )}
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>

                        {selectedCustomer && (
                            <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 p-4 text-sm text-emerald-800 dark:text-emerald-200">
                                Seçilen müşteriye yeni ürün/randevu talebi açılacak; eski kayıt silinmez veya
                                değiştirilmez.
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <label className="text-sm font-semibold flex items-center gap-2">
                            <User className="w-4 h-4" /> Yeni Müşteri Adı *
                        </label>
                        <input
                            className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            placeholder="Ad soyad..."
                        />
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold">Telefon</label>
                        <input
                            className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="05xx..."
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-semibold flex items-center gap-2">
                            <PackagePlus className="w-4 h-4" /> Yeni ürün / talep
                        </label>
                        <input
                            className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                            value={productRequest}
                            onChange={(e) => setProductRequest(e.target.value)}
                            placeholder="Salon perde, stor, zebra, tamir..."
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-semibold flex items-center gap-2">
                        <MapPin className="w-4 h-4" /> Randevu Adresi
                    </label>
                    <textarea
                        className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                        rows={2}
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="Adres..."
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold">Tarih *</label>
                        <input
                            type="date"
                            ref={dateInputRef}
                            className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-semibold flex items-center gap-2">
                            <Clock className="w-4 h-4" /> Saat *
                        </label>
                        <input
                            type="time"
                            ref={timeInputRef}
                            className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                            value={time}
                            onChange={(e) => setTime(e.target.value)}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold">Randevu Türü</label>
                        <select
                            className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                        >
                            <option value="measurement">Ölçü Randevusu</option>
                            <option value="installation">Montaj Randevusu</option>
                            <option value="other">Diğer</option>
                        </select>
                    </div>
                    {role === "installer" || role === "measurement" ? (
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-primary-700">Personel Ataması</label>
                            <div className="rounded-xl border-2 border-primary-100 bg-primary-50/70 p-3 text-sm font-semibold text-primary-800 dark:border-primary-900/40 dark:bg-primary-900/10 dark:text-primary-200">
                                Bu randevu otomatik olarak size atanacak.
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-primary-700">Atanacak Personel</label>
                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                            <select
                                ref={assignedSelectRef}
                                className="w-full p-3 rounded-xl border-2 border-primary-200 dark:border-primary-900 bg-primary-50/50 dark:bg-primary-900/10 focus:ring-2 focus:ring-primary-500 outline-none"
                                value={assignedTo}
                                onChange={(e) => setAssignedTo(e.target.value)}
                            >
                                <option value="">Personel seçin</option>
                                {staffList.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.full_name} ({roleText(s.role)})
                                    </option>
                                ))}
                            </select>
                                <button
                                    type="button"
                                    onClick={() => nav("/staff")}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-slate-800"
                                >
                                    <UserPlus className="w-4 h-4" />
                                    Montajcı Ekle
                                </button>
                            </div>
                            {staffList.length === 0 ? (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                                    Henüz aktif montajcı yok. Montajcı ekleyip tekrar bu randevuya dönebilirsiniz.
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-semibold flex items-center gap-2">
                        <ClipboardList className="w-4 h-4" /> Randevu Notu
                    </label>
                    <textarea
                        className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                        rows={3}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Ek notlar..."
                    />
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                        type="button"
                        onClick={() => nav(-1)}
                        className="flex-1 px-6 py-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
                    >
                        İptal
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={loading}
                        className="flex-[2] px-6 py-4 rounded-2xl bg-primary-600 text-white font-black shadow-lg shadow-primary-600/30 hover:bg-primary-700 transition-all disabled:opacity-50"
                    >
                        {loading ? "Kaydediliyor..." : "Randevu Oluştur"}
                    </button>
                </div>
            </div>
        </div>
    );
}
