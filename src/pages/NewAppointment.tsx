import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { normalizeRole, type RoleState } from "../auth/roles";
import { useRole } from "../context/RoleContext";
import { findDuplicatePhone, duplicatePhoneMessage, phoneConstraintMessage } from "../utils/phoneUtils";
import {
    getNotificationSettings,
    REMINDER_OPTIONS,
    scheduleReminderNotification,
    type ReminderOffset,
    type ReminderTaskType,
} from "../utils/localNotifications";
import {
    Calendar,
    CheckCircle2,
    ClipboardList,
    Clock,
    MapPin,
    MessageCircle,
    Navigation,
    Phone,
    Search,
    User,
    UserPlus,
    X,
} from "lucide-react";

type Customer = {
    id: string;
    name: string | null;
    phone: string | null;
    address: string | null;
};

type StaffMember = {
    id: string;
    userId?: string | null;
    employeeId?: string | null;
    full_name: string;
    role: string;
};

type CustomerMode = "existing" | "new";

async function getContext() {
    return getEffectiveTenantContext();
}


type AppointmentRow = {
    id: string;
    title: string | null;
    type: string | null;
    status: string | null;
    start_at: string | null;
    address: string | null;
    note: string | null;
    customer: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null;
};

function apptCustomer(row: AppointmentRow) {
    return Array.isArray(row.customer) ? row.customer[0] : row.customer;
}

function formatApptDate(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString("tr-TR")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function getTypeLabel(type?: string | null) {
    const value = String(type ?? "").toLowerCase();
    if (value === "installation") return "Montaj Randevusu";
    if (value === "measurement") return "Ölçü Randevusu";
    if (value === "customer_meeting") return "Müşteri Görüşmesi";
    if (value === "payment_reminder") return "Tahsilat Hatırlatma";
    return "Randevu";
}

const APPT_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
    planned: { label: "Planlandı", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
    done: { label: "Tamamlandı", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    measured: { label: "Ölçüldü", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300" },
    cancelled: { label: "İptal", cls: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300" },
};

function toTRPhone(raw?: string | null) {
    if (!raw) return "";
    let p = raw.replace(/\D/g, "");
    if (p.startsWith("0")) p = p.slice(1);
    if (p.length === 10 && p.startsWith("5")) p = "90" + p;
    if (!p.startsWith("90") && p.length > 0) p = "90" + p;
    return p;
}

function openWhatsApp(rawPhone: string, message: string) {
    const digits = toTRPhone(rawPhone);
    if (!digits) return;
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
}

function openMaps(destination: string) {
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`, "_blank", "noopener,noreferrer");
}

interface StatCardProps {
    label: string;
    count: number;
    color: "blue" | "orange" | "red" | "green";
    isActive: boolean;
    onClick: () => void;
}

function StatCard({ label, count, color, isActive, onClick }: StatCardProps) {
    const colorClasses = {
        blue: isActive ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border-blue-200 dark:border-blue-900",
        orange: isActive ? "bg-orange-600 text-white" : "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300 border-orange-200 dark:border-orange-900",
        red: isActive ? "bg-red-600 text-white" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border-red-200 dark:border-red-900",
        green: isActive ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900",
    };

    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-1 rounded-2xl border p-4 text-center transition ${colorClasses[color]} ${
                !isActive ? "border" : "border-0 shadow-lg"
            }`}
        >
            <div className="text-2xl font-black">{count}</div>
            <div className="text-xs font-semibold mt-1">{label}</div>
        </button>
    );
}

type SummaryFilter = "all" | "today" | "upcoming" | "overdue" | "done";

export default function NewAppointment() {
    const nav = useNavigate();
    const location = useLocation();
    const { effectiveRole, realRole, viewingUserId } = useRole();
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    const [success, setSuccess] = useState("");
    const [apptList, setApptList] = useState<AppointmentRow[]>([]);
    const [apptLoading, setApptLoading] = useState(false);
    const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>("today");
    const [actionId, setActionId] = useState<string | null>(null);
    const [showFormModal, setShowFormModal] = useState(false);

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
    const [date, setDate] = useState("");
    const [time, setTime] = useState("");
    const [assignedTo, setAssignedTo] = useState("");
    const [note, setNote] = useState("");
    const [type, setType] = useState("measurement");
    const [reminderOffset, setReminderOffset] = useState<ReminderOffset>(() => getNotificationSettings().defaultReminderOffset);
    const [showStaffForm, setShowStaffForm] = useState(false);
    const [newStaffName, setNewStaffName] = useState("");
    const [newStaffSaving, setNewStaffSaving] = useState(false);
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
                const allEmployeeRows = (employeeRes.data ?? []);
                const employeeRows = allEmployeeRows.filter((employee: any) => Boolean(employee.user_id));
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
                            userId: s.user_id,
                            employeeId: null,
                            full_name: s.full_name || "İsimsiz",
                            role: s.role || "installer",
                        })),
                );
                if (employeeRows.length === 0 && allEmployeeRows.length > 0) {
                    setStaffList(
                        allEmployeeRows
                            .filter((employee: any) => normalizeRole(employee.target_role) === "installer" || normalizeRole(employee.target_role) === "measurement")
                            .map((employee: any) => ({
                                id: `employee:${employee.id}`,
                                userId: null,
                                employeeId: employee.id,
                                full_name: employee.full_name || "İsimsiz",
                                role: employee.target_role || "installer",
                            })),
                    );
                }
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

    useEffect(() => {
        if (location.state?.customerId && customers.length > 0) {
            const found = customers.find(c => c.id === location.state.customerId);
            if (found) {
                selectCustomer(found);
                if (location.state?.type) {
                    setType(location.state.type);
                }
            }
        }
    }, [location.state, customers]);

    function buildNote() {
        return note.trim();
    }

    function resetFormFields() {
        if (customerMode === "new") {
            setCustomerName("");
            setPhone("");
            setAddress("");
        }
        setDate("");
        setTime("");
        setNote("");
        setType("measurement");
        setAssignedTo("");
        setReminderOffset(getNotificationSettings().defaultReminderOffset);
        setShowStaffForm(false);
        setNewStaffName("");
    }

    async function handleCreateInstaller() {
        if (!companyId) {
            setErr("Şirket bilgisi yüklenemedi.");
            return;
        }
        if (!newStaffName.trim()) {
            setErr("Montajcı adı zorunludur.");
            return;
        }

        setNewStaffSaving(true);
        setErr("");
        try {
            const { data, error } = await supabase
                .from("employees")
                .insert([{
                    company_id: companyId,
                    full_name: newStaffName.trim(),
                    target_role: "installer",
                    is_active: true,
                }])
                .select("id,full_name,target_role")
                .single();

            if (error) throw error;

            const staff: StaffMember = {
                id: `employee:${data.id}`,
                userId: null,
                employeeId: data.id,
                full_name: data.full_name || newStaffName.trim(),
                role: data.target_role || "installer",
            };

            setStaffList((prev) => [...prev, staff].sort((a, b) => a.full_name.localeCompare(b.full_name, "tr")));
            setAssignedTo(staff.id);
            setNewStaffName("");
            setShowStaffForm(false);
        } catch (e: any) {
            setErr(e?.message ?? "Montajcı eklenemedi.");
        } finally {
            setNewStaffSaving(false);
        }
    }

    async function handleSave() {
        setSuccess("");
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
                if (phone.trim() && companyId) {
                    const duplicate = await findDuplicatePhone({ companyId, phone: phone.trim() });
                    if (duplicate) {
                        setErr(duplicatePhoneMessage(duplicate.name, phone.trim()));
                        setLoading(false);
                        return;
                    }
                }

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
                    if (retry.error) {
                        throw new Error(phoneConstraintMessage(retry.error.message, phone.trim()));
                    }
                    finalCustomerId = retry.data.id;
                } else {
                    if (cErr) {
                        throw new Error(phoneConstraintMessage(cErr.message, phone.trim()));
                    }
                    finalCustomerId = newCust.id;
                }
            }

            const startAt = new Date(`${finalDate}T${finalTime}:00`).toISOString();
            const appointmentNote = buildNote();
            const title = getTypeLabel(type);

            const selectedStaff = staffList.find((staff) => staff.id === finalAssignedTo) ?? null;
            const selectedStaffUserId = selectedStaff?.userId || (finalAssignedTo && !finalAssignedTo.startsWith("employee:") ? finalAssignedTo : "");
            const assignedUserId = role === "installer" || role === "measurement" ? (viewingUserId || userId) : (selectedStaffUserId || null);
            const offsetMinutes: Record<string, number> = { at_time: 0, "15m": 15, "30m": 30, "1h": 60, "1d": 1440 };
            const reminderAt = new Date(new Date(startAt).getTime() - (offsetMinutes[reminderOffset] ?? 30) * 60 * 1000).toISOString();

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
                    reminder_offset: reminderOffset,
                    reminder_enabled: true,
                    reminder_sent: false,
                    reminder_at: reminderAt,
                    notification_status: "planned",
            };

            let { data: appointmentRow, error: apptErr } = await supabase.from("appointments").insert([appointmentPayload]).select("id").single();

            if (apptErr) {
                const message = String(apptErr.message || "").toLowerCase();
                if (message.includes("column") || message.includes("schema cache")) {
                    const fallbackPayload: any = { ...appointmentPayload };
                    delete fallbackPayload.created_by;
                    delete fallbackPayload.assigned_user_id;
                    delete fallbackPayload.assigned_role;
                    delete fallbackPayload.reminder_offset;
                    delete fallbackPayload.reminder_enabled;
                    delete fallbackPayload.reminder_sent;
                    delete fallbackPayload.reminder_at;
                    delete fallbackPayload.notification_status;
                    const retry = await supabase.from("appointments").insert([fallbackPayload]).select("id").single();
                    appointmentRow = retry.data;
                    apptErr = retry.error;
                }
            }

            if (apptErr) throw apptErr;
            const appointmentId = appointmentRow?.id;
            if (appointmentId) {
                const displayCustomerName = customerMode === "new" ? nameForNewCustomer : customerName;
                const taskType: ReminderTaskType = type === "measurement" ? "measurement" : type === "installation" ? "installation" : "other";
                await scheduleReminderNotification({
                    id: `appointment:${appointmentId}`,
                    title,
                    customerName: displayCustomerName,
                    phone,
                    address,
                    taskType,
                    startAt,
                    reminderOffset,
                    detailUrl: `/appointments/${appointmentId}`,
                });

                if (userId) {
                    const d = new Date(startAt);
                    const dateLabel = `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${d.getFullYear()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
                    try {
                        await supabase.from("notifications").insert([{
                            user_id: userId,
                            title: "Yaklaşan randevu",
                            message: `${title} — ${displayCustomerName || "Müşteri"}, ${dateLabel}`,
                            type: "info",
                        }]);
                    } catch { /* yoksay */ }
                }
            }

            if (assignedUserId && assignedUserId !== (viewingUserId || userId)) {
                const dateObj = new Date(startAt);
                const dateStr = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()} ${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
                const displayCustomerName = customerMode === "new" ? nameForNewCustomer : customerName;

                await supabase.from("notifications").insert([{
                    user_id: assignedUserId,
                    title: "Yeni Görev Atandı",
                    message: `Size yeni bir ${title} atandı. Tarih: ${dateStr}. Müşteri: ${displayCustomerName || "Bilinmiyor"}`,
                    type: "info"
                }]);
            }

            setSuccess("Randevu başarıyla oluşturuldu!");
            resetFormFields();
            setShowFormModal(false);
            await loadAppointments();

            setTimeout(() => {
                setSuccess("");
            }, 3000);
        } catch (e: any) {
            const msg = String(e?.message || "");
            setErr(
                msg.includes("column") || msg.includes("schema")
                    ? "Randevu kaydedilemedi. Lütfen sayfayı yenileyip tekrar deneyin."
                    : msg || "Randevu kaydedilemedi. Lütfen tekrar deneyin."
            );
        } finally {
            setLoading(false);
        }
    }

    async function loadAppointments(cid?: string) {
        const targetCompany = cid || companyId;
        if (!targetCompany) return;
        setApptLoading(true);
        try {
            const { data, error } = await supabase
                .from("appointments")
                .select("id, title, type, status, start_at, address, note, customer:customers(name, phone)")
                .eq("company_id", targetCompany)
                .order("start_at", { ascending: false })
                .limit(200);
            if (!error) setApptList((data ?? []) as AppointmentRow[]);
        } finally {
            setApptLoading(false);
        }
    }

    useEffect(() => {
        if (companyId) void loadAppointments(companyId);
    }, [companyId]);

    async function updateApptStatus(id: string, status: "done" | "cancelled") {
        if (status === "cancelled" && !window.confirm("Bu randevu iptal edilsin mi?")) return;
        setActionId(id);
        setErr("");
        try {
            const payload: Record<string, any> = { status };
            if (status === "done") payload.done = true;
            const { error } = await supabase
                .from("appointments")
                .update(payload)
                .eq("id", id)
                .eq("company_id", companyId);
            if (error) throw error;
            setApptList((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
        } catch {
            setErr("Randevu güncellenemedi. Lütfen tekrar deneyin.");
        } finally {
            setActionId(null);
        }
    }

    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    const apptGroups = useMemo(() => {
        const today: AppointmentRow[] = [];
        const upcoming: AppointmentRow[] = [];
        const overdue: AppointmentRow[] = [];
        const done: AppointmentRow[] = [];

        apptList.forEach((a) => {
            const t = a.start_at ? new Date(a.start_at).getTime() : 0;

            if (a.status === "done" || a.status === "measured") {
                done.push(a);
            } else if (a.status === "cancelled") {
                // Gösterme
            } else if (t >= dayStart && t < dayEnd) {
                today.push(a);
            } else if (t >= dayEnd) {
                upcoming.push(a);
            } else {
                overdue.push(a);
            }
        });

        today.sort((a, b) => (a.start_at || "").localeCompare(b.start_at || ""));
        upcoming.sort((a, b) => (a.start_at || "").localeCompare(b.start_at || ""));
        overdue.sort((a, b) => (b.start_at || "").localeCompare(a.start_at || ""));
        done.sort((a, b) => (b.start_at || "").localeCompare(a.start_at || ""));

        return { today, upcoming, overdue, done };
    }, [apptList]);

    const visibleAppts = useMemo(() => {
        if (summaryFilter === "today") return apptGroups.today;
        if (summaryFilter === "upcoming") return apptGroups.upcoming;
        if (summaryFilter === "overdue") return apptGroups.overdue;
        if (summaryFilter === "done") return apptGroups.done;
        return apptList;
    }, [summaryFilter, apptGroups, apptList]);

    const getStatusColor = (appt: AppointmentRow): "blue" | "orange" | "red" | "green" => {
        if (appt.status === "done" || appt.status === "measured") return "green";
        if (appt.status === "cancelled") return "red";
        const t = appt.start_at ? new Date(appt.start_at).getTime() : 0;
        if (t >= dayStart && t < dayEnd) return "blue";
        if (t >= dayEnd) return "orange";
        return "red";
    };

    const getStatusBgClass = (color: "blue" | "orange" | "red" | "green"): string => {
        const classes = {
            blue: "border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20",
            orange: "border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-900/20",
            red: "border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20",
            green: "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20",
        };
        return classes[color];
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <div className="max-w-4xl mx-auto p-4 sm:p-6">
                {/* Header */}
                <div className="flex items-center gap-3 mb-8">
                    <div className="p-3 bg-primary-100 dark:bg-primary-900/30 text-primary-600 rounded-2xl">
                        <Calendar className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white">Randevular</h1>
                        <p className="text-slate-500 text-sm">
                            Ölçü, montaj ve müşteri görüşmelerinizi tek ekrandan takip edin.
                        </p>
                    </div>
                </div>

                {/* Messages */}
                {err && (
                    <div className="mb-4 p-4 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-900/50">
                        {err}
                    </div>
                )}
                {success && (
                    <div className="mb-4 p-4 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 rounded-xl border border-emerald-200 dark:border-emerald-900/50">
                        ✓ {success}
                    </div>
                )}

                {/* Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
                    <StatCard
                        label="Bugün"
                        count={apptGroups.today.length}
                        color="blue"
                        isActive={summaryFilter === "today"}
                        onClick={() => setSummaryFilter("today")}
                    />
                    <StatCard
                        label="Yaklaşan"
                        count={apptGroups.upcoming.length}
                        color="orange"
                        isActive={summaryFilter === "upcoming"}
                        onClick={() => setSummaryFilter("upcoming")}
                    />
                    <StatCard
                        label="Geciken"
                        count={apptGroups.overdue.length}
                        color="red"
                        isActive={summaryFilter === "overdue"}
                        onClick={() => setSummaryFilter("overdue")}
                    />
                    <StatCard
                        label="Tamamlanan"
                        count={apptGroups.done.length}
                        color="green"
                        isActive={summaryFilter === "done"}
                        onClick={() => setSummaryFilter("done")}
                    />
                </div>

                {/* Create Button */}
                <button
                    type="button"
                    onClick={() => {
                        setShowFormModal(true);
                        setErr("");
                    }}
                    className="w-full mb-8 px-6 py-4 rounded-2xl bg-primary-600 text-white font-black shadow-lg shadow-primary-600/30 hover:bg-primary-700 transition-all flex items-center justify-center gap-2"
                >
                    <UserPlus className="w-5 h-5" />
                    + Yeni Randevu Oluştur
                </button>

                {/* Form Modal */}
                {showFormModal && (
                    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-50 flex items-end sm:items-center justify-center p-4">
                        <div className="bg-white dark:bg-slate-900 rounded-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto w-full max-w-2xl shadow-2xl">
                            {/* Modal Header */}
                            <div className="sticky top-0 flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                                <h2 className="text-xl font-black text-slate-900 dark:text-white">Yeni Randevu Oluştur</h2>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowFormModal(false);
                                        setErr("");
                                        resetFormFields();
                                    }}
                                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-6 space-y-6">
                                {err && (
                                    <div className="p-4 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-900/50">
                                        {err}
                                    </div>
                                )}

                                {/* Customer Mode Tabs */}
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

                                {/* Customer Selection */}
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

                                        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-64 overflow-y-auto">
                                            {filteredCustomers.length === 0 ? (
                                                <div className="p-4 text-sm text-slate-500">
                                                    Müşteri bulunamadı.
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
                                                                    {[customer.phone, customer.address].filter(Boolean).join(" • ") || "—"}
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
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <label className="text-sm font-semibold flex items-center gap-2">
                                            <User className="w-4 h-4" /> Müşteri Adı *
                                        </label>
                                        <input
                                            className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                                            value={customerName}
                                            onChange={(e) => setCustomerName(e.target.value)}
                                            placeholder="Ad soyad..."
                                        />

                                        <div className="grid grid-cols-2 gap-3">
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
                                                <label className="text-sm font-semibold">Adres</label>
                                                <input
                                                    className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                                                    value={address}
                                                    onChange={(e) => setAddress(e.target.value)}
                                                    placeholder="Adres..."
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Appointment Type */}
                                <div className="space-y-2">
                                    <label className="text-sm font-semibold">Randevu Türü *</label>
                                    <select
                                        className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                                        value={type}
                                        onChange={(e) => {
                                            setType(e.target.value);
                                            if (e.target.value !== "installation") {
                                                setAssignedTo("");
                                            }
                                        }}
                                    >
                                        <option value="measurement">Ölçü Randevusu</option>
                                        <option value="installation">Montaj Randevusu</option>
                                        <option value="customer_meeting">Müşteri Görüşmesi</option>
                                        <option value="payment_reminder">Tahsilat Hatırlatma</option>
                                        <option value="other">Diğer</option>
                                    </select>
                                </div>

                                {/* Date & Time */}
                                <div className="grid grid-cols-2 gap-4">
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

                                {/* Installer (only for installation) */}
                                {type === "installation" && role !== "installer" && role !== "measurement" && (
                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold">Montajcı Seç</label>
                                        <div className="grid grid-cols-[1fr_auto] gap-2">
                                            <select
                                                ref={assignedSelectRef}
                                                className="w-full p-3 rounded-xl border-2 border-primary-200 dark:border-primary-900 bg-primary-50/50 dark:bg-primary-900/10 focus:ring-2 focus:ring-primary-500 outline-none"
                                                value={assignedTo}
                                                onChange={(e) => setAssignedTo(e.target.value)}
                                            >
                                                <option value="">Montajcı seçin</option>
                                                {staffList.map((s) => (
                                                    <option key={s.id} value={s.id}>
                                                        {s.full_name}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => setShowStaffForm((value) => !value)}
                                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-slate-800"
                                            >
                                                <UserPlus className="w-4 h-4" />
                                            </button>
                                        </div>
                                        {showStaffForm && (
                                            <div className="grid gap-2 rounded-xl border border-primary-100 bg-primary-50/50 p-3 dark:border-primary-900/40 dark:bg-primary-900/10 grid-cols-[1fr_auto]">
                                                <input
                                                    value={newStaffName}
                                                    onChange={(e) => setNewStaffName(e.target.value)}
                                                    className="min-h-11 rounded-xl border border-primary-100 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 dark:border-primary-900 dark:bg-slate-900"
                                                    placeholder="Montajcı adı"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleCreateInstaller}
                                                    disabled={newStaffSaving}
                                                    className="min-h-11 rounded-xl bg-primary-600 px-4 text-sm font-black text-white disabled:opacity-60"
                                                >
                                                    {newStaffSaving ? "..." : "Ekle"}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Reminder */}
                                <div className="space-y-2">
                                    <label className="text-sm font-semibold">Hatırlatma Zamanı</label>
                                    <select
                                        className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                                        value={reminderOffset}
                                        onChange={(e) => setReminderOffset(e.target.value as ReminderOffset)}
                                    >
                                        {REMINDER_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Notes */}
                                <div className="space-y-2">
                                    <label className="text-sm font-semibold flex items-center gap-2">
                                        <ClipboardList className="w-4 h-4" /> Not
                                    </label>
                                    <textarea
                                        className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 outline-none"
                                        rows={2}
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        placeholder="Ek notlar..."
                                    />
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="sticky bottom-0 flex gap-3 p-6 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowFormModal(false);
                                        setErr("");
                                        resetFormFields();
                                    }}
                                    className="flex-1 px-6 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
                                >
                                    İptal
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSave}
                                    disabled={loading}
                                    className="flex-1 px-6 py-3 rounded-2xl bg-primary-600 text-white font-black hover:bg-primary-700 transition-all disabled:opacity-50"
                                >
                                    {loading ? "Kaydediliyor..." : "Oluştur"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Appointment List */}
                <h2 className="mb-4 text-lg font-black text-slate-900 dark:text-white">
                    {summaryFilter === "today"
                        ? "Bugünün Randevuları"
                        : summaryFilter === "upcoming"
                          ? "Yaklaşan Randevular"
                          : summaryFilter === "overdue"
                            ? "Geciken Randevular"
                            : "Tamamlanan Randevular"}
                </h2>

                {apptLoading ? (
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
                        Randevular yükleniyor...
                    </div>
                ) : visibleAppts.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
                        {summaryFilter === "today"
                            ? "Bugün için randevu yok."
                            : summaryFilter === "upcoming"
                              ? "Yaklaşan randevu yok."
                              : summaryFilter === "overdue"
                                ? "Geciken randevu yok."
                                : "Tamamlanan randevu yok."}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {visibleAppts.map((a) => {
                            const cust = apptCustomer(a);
                            const st = APPT_STATUS_LABELS[String(a.status || "planned")] ?? APPT_STATUS_LABELS.planned;
                            const isActive = a.status !== "cancelled" && a.status !== "done";
                            const statusColor = getStatusColor(a);
                            const bgClass = getStatusBgClass(statusColor);

                            return (
                                <div
                                    key={a.id}
                                    className={`rounded-2xl border ${bgClass} p-5 shadow-sm`}
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="font-black text-slate-900 dark:text-white text-lg">
                                                    {cust?.name || "Müşteri"}
                                                </span>
                                                <span className={`rounded-full px-2.5 py-0.5 text-xs font-black ${st.cls}`}>
                                                    {st.label}
                                                </span>
                                            </div>

                                            <div className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="w-4 h-4 text-slate-500" />
                                                    {formatApptDate(a.start_at)}
                                                </div>
                                                {cust?.phone && (
                                                    <div className="flex items-center gap-2">
                                                        <Phone className="w-4 h-4 text-slate-500" />
                                                        {cust.phone}
                                                    </div>
                                                )}
                                                {a.address && (
                                                    <div className="flex items-center gap-2">
                                                        <MapPin className="w-4 h-4 text-slate-500" />
                                                        {a.address}
                                                    </div>
                                                )}
                                                {a.title && (
                                                    <div className="font-semibold text-slate-900 dark:text-white">
                                                        {a.title}
                                                    </div>
                                                )}
                                                {a.note && (
                                                    <div className="text-slate-600 dark:text-slate-400 text-xs">
                                                        {a.note.length > 100 ? a.note.slice(0, 100) + "…" : a.note}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap sm:flex-col gap-2 shrink-0">
                                            {cust?.phone && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => openWhatsApp(cust.phone || "", `Merhaba ${cust.name}, randevunuz hakkında bilgilendirmek istiyorum.`)}
                                                        className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition"
                                                        title="WhatsApp"
                                                    >
                                                        <MessageCircle className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => window.location.href = `tel:${cust.phone}`}
                                                        className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 transition"
                                                        title="Ara"
                                                    >
                                                        <Phone className="w-4 h-4" />
                                                    </button>
                                                </>
                                            )}
                                            {a.address && (
                                                <button
                                                    type="button"
                                                    onClick={() => openMaps(a.address || "")}
                                                    className="inline-flex items-center justify-center gap-1 rounded-lg bg-purple-600 px-3 py-2 text-xs font-bold text-white hover:bg-purple-700 transition"
                                                    title="Harita"
                                                >
                                                    <Navigation className="w-4 h-4" />
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => nav(`/appointments/${a.id}`)}
                                                className="inline-flex items-center rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition w-full sm:w-auto justify-center"
                                            >
                                                Düzenle
                                            </button>
                                            {isActive && (
                                                <>
                                                    <button
                                                        type="button"
                                                        disabled={actionId === a.id}
                                                        onClick={() => void updateApptStatus(a.id, "done")}
                                                        className="inline-flex items-center rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 transition disabled:opacity-50 w-full sm:w-auto justify-center"
                                                    >
                                                        Tamamlandı
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={actionId === a.id}
                                                        onClick={() => void updateApptStatus(a.id, "cancelled")}
                                                        className="inline-flex items-center rounded-lg border border-red-300 dark:border-red-900 px-3 py-2 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition disabled:opacity-50 w-full sm:w-auto justify-center"
                                                    >
                                                        İptal
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
