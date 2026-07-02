import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { normalizeRole, type RoleState } from "../auth/roles";
import {
    cancelReminderNotification,
    getNotificationSettings,
    scheduleReminderNotification,
    type ReminderTaskType,
} from "../utils/localNotifications";
import {
    AlertCircle,
    ArrowLeft,
    Calendar,
    CheckCircle2,
    ClipboardList,
    Clock,
    Edit3,
    MapPin,
    Phone,
    Save,
    Trash2,
    XCircle,
} from "lucide-react";

type AppointmentRow = {
    id: string;
    customer_id: string | null;
    company_id: string | null;
    type: string | null;
    title: string | null;
    start_at: string | null;
    address: string | null;
    note: string | null;
    status: string | null;
    measurement_notes: string | null;
    assigned_to: string | null;
    assigned_user_id?: string | null;
    reminder_offset?: string | null;
    customer?: { name: string | null; phone: string | null } | Array<{ name: string | null; phone: string | null }> | null;
};

type StaffOption = {
    id: string;
    full_name: string;
    role: string;
};

function roleLabel(role: string) {
    if (role === "admin") return "Yönetici";
    if (role === "installer" || role === "measurement") return "Montaj Personeli";
    if (role === "accountant") return "Muhasebe";
    return "Personel";
}

function taskTypeFromAppointment(type?: string | null): ReminderTaskType {
    if (type === "measurement") return "measurement";
    if (type === "installation") return "installation";
    return "other";
}

export default function AppointmentDetail() {
    const { id } = useParams<{ id: string }>();
    const nav = useNavigate();

    const [row, setRow] = useState<AppointmentRow | null>(null);
    const [loading, setLoading] = useState(true);
    const [role, setRole] = useState<RoleState>("unknown");
    const [saving, setSaving] = useState(false);
    const [staffList, setStaffList] = useState<StaffOption[]>([]);

    const [isEditMode, setIsEditMode] = useState(false);
    const [mNotes, setMNotes] = useState("");
    const [editDate, setEditDate] = useState("");
    const [editTime, setEditTime] = useState("");
    const [editAddress, setEditAddress] = useState("");
    const [editAssignedTo, setEditAssignedTo] = useState("");
    const editAssignedRef = useRef<HTMLSelectElement | null>(null);

    const loadData = useCallback(async () => {
        if (!id) return;
        setLoading(true);

        try {
            const { data, error } = await supabase
                .from("appointments")
                .select("id, customer_id, company_id, type, title, start_at, address, note, status, measurement_notes, assigned_to, assigned_user_id, customer:customers(name, phone)")
                .eq("id", id)
                .single();

            if (error) throw error;

            const appointment = data as unknown as AppointmentRow;
            setRow(appointment);
            setMNotes(appointment.measurement_notes || "");
            setEditAddress(appointment.address || "");
            setEditAssignedTo(appointment.assigned_to || "");

            if (appointment.start_at) {
                const dt = new Date(appointment.start_at);
                setEditDate(dt.toISOString().slice(0, 10));
                setEditTime(dt.toTimeString().slice(0, 5));
            }

            const { data: auth } = await supabase.auth.getUser();
            const user = auth.user;

            if (user) {
                const { data: profile } = await supabase
                    .from("profiles")
                    .select("role")
                    .eq("user_id", user.id)
                    .maybeSingle();

                if (profile) {
                    setRole(normalizeRole(profile.role));
                }

                const { data: myCompany } = await supabase
                    .from("company_members")
                    .select("company_id")
                    .eq("user_id", user.id)
                    .maybeSingle();

                if (myCompany?.company_id) {
                    const normalizedRole = normalizeRole(profile?.role);
                    const isSameCompany = appointment.company_id === myCompany.company_id;
                    const isAssignedStaff = appointment.assigned_to === user.id || appointment.assigned_user_id === user.id;

                    if (!isSameCompany || ((normalizedRole === "installer" || normalizedRole === "measurement" || normalizedRole === "personnel") && !isAssignedStaff)) {
                        setRow(null);
                        throw new Error("Bu randevuya erişim yetkiniz yok.");
                    }

                    const { data: employees } = await supabase
                        .from("employees")
                        .select("user_id, full_name, target_role, is_active")
                        .eq("company_id", myCompany.company_id);

                    const employeeRows = (employees ?? []).filter((employee: any) => employee.is_active !== false && Boolean(employee.user_id));

                    const { data: members } = await supabase
                        .from("company_members")
                        .select("user_id")
                        .eq("company_id", myCompany.company_id);

                    const employeeIds = employeeRows.map((employee: any) => employee.user_id).filter(Boolean);
                    const memberIds = (members ?? []).map((member) => member.user_id).filter(Boolean);
                    const ids = Array.from(new Set(employeeIds.length > 0 ? employeeIds : memberIds));
                    if (ids.length > 0) {
                        const { data: profiles } = await supabase
                            .from("profiles")
                            .select("user_id, full_name, role")
                            .in("user_id", ids)
                            .order("full_name");

                        const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
                        const staffRows = employeeRows.length > 0
                            ? employeeRows.map((employee: any) => {
                                const profile = profileById.get(employee.user_id);
                                return {
                                    user_id: employee.user_id,
                                    full_name: employee.full_name || profile?.full_name || "İsimsiz",
                                    role: profile?.role || employee.target_role || "installer",
                                };
                            })
                            : (profiles ?? []);

                        setStaffList(
                            staffRows
                                .filter((item) => {
                                    const staffRole = normalizeRole(item.role);
                                    return staffRole === "installer" || staffRole === "measurement" || staffRole === "personnel";
                                })
                                .map((item) => ({
                                    id: item.user_id,
                                    full_name: item.full_name || "İsimsiz",
                                    role: item.role || "installer",
                                })),
                        );
                    }
                }
            }
        } catch (e: any) {
            console.error(e?.message || e);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    async function handleUpdateAppointment() {
        if (!id) return;
        setSaving(true);

        try {
            const nextStartAt = editDate && editTime ? new Date(`${editDate}T${editTime}:00`).toISOString() : null;
            const nextAssignedTo = editAssignedTo || editAssignedRef.current?.value || "";
            const { error } = await supabase
                .from("appointments")
                .update({
                    start_at: nextStartAt,
                    address: editAddress || null,
                    measurement_notes: mNotes || null,
                    assigned_to: nextAssignedTo || null,
                    assigned_user_id: nextAssignedTo || null,
                    assigned_role: nextAssignedTo ? "installer" : null,
                })
                .eq("id", id);

            if (error) throw error;
            const customerData = Array.isArray(row?.customer) ? row?.customer[0] : row?.customer;
            await scheduleReminderNotification({
                id: `appointment:${id}`,
                title: row?.title || "Randevu hatırlatması",
                customerName: customerData?.name,
                phone: customerData?.phone,
                address: editAddress || row?.address,
                taskType: taskTypeFromAppointment(row?.type),
                startAt: nextStartAt,
                reminderOffset: (row?.reminder_offset as any) || getNotificationSettings().defaultReminderOffset,
                detailUrl: `/appointments/${id}`,
            });
            setIsEditMode(false);
            await loadData();
        } catch (e: any) {
            alert(`Hata: ${e?.message || "Randevu guncellenemedi."}`);
        } finally {
            setSaving(false);
        }
    }

    async function handleCancelAppointment() {
        if (!id || !window.confirm("Bu randevu iptal edilsin mi?")) return;
        setSaving(true);

        try {
            const { error } = await supabase.from("appointments").update({ status: "cancelled" }).eq("id", id);
            if (error) throw error;
            await cancelReminderNotification(`appointment:${id}`);
            await loadData();
        } catch (e: any) {
            alert(`Hata: ${e?.message || "Randevu iptal edilemedi."}`);
        } finally {
            setSaving(false);
        }
    }

    async function handleSaveMeasurementOnly() {
        if (!id) return;
        setSaving(true);

        try {
            const { error } = await supabase
                .from("appointments")
                .update({
                    measurement_notes: mNotes || null,
                    status: "measured",
                    assigned_to: editAssignedTo || row?.assigned_to || null,
                    assigned_user_id: editAssignedTo || row?.assigned_user_id || row?.assigned_to || null,
                })
                .eq("id", id);

            if (error) throw error;
            await loadData();
        } catch (e: any) {
            alert(`Hata: ${e?.message || "Olcu kaydedilemedi."}`);
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        if (!id || !window.confirm("Bu randevu kalici olarak silinsin mi?")) return;
        const { error } = await supabase.from("appointments").delete().eq("id", id);
        if (error) {
            alert(error.message);
            return;
        }
        await cancelReminderNotification(`appointment:${id}`);
        nav("/route/today");
    }

    if (loading) return <div className="p-10 text-center font-bold">Veriler getiriliyor...</div>;
    if (!row) return <div className="p-10 text-center">Randevu bulunamadi.</div>;

    const assignedName = staffList.find((staff) => staff.id === (isEditMode ? editAssignedTo : row.assigned_to))?.full_name;
    const customerData = Array.isArray(row.customer) ? row.customer[0] : row.customer;

    return (
        <div className="max-w-5xl mx-auto space-y-6 pb-20 px-4">
            <div className="flex items-center justify-between">
                <button
                    onClick={() => nav(-1)}
                    className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:bg-slate-50 transition shadow-sm"
                >
                    <ArrowLeft className="w-5 h-5 text-slate-600" />
                </button>

                <div className="flex gap-2">
                    {!isEditMode && row.status !== "cancelled" && (role === "admin" || role === "accountant" || role === "installer" || role === "measurement" || role === "personnel") && (
                        <button
                            onClick={() => setIsEditMode(true)}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-emerald-100 dark:border-emerald-900/30 text-emerald-600 hover:bg-emerald-50 transition font-bold text-sm"
                        >
                            <Edit3 className="w-4 h-4" /> Duzenle
                        </button>
                    )}
                    {row.status !== "cancelled" && row.status !== "done" && (role === "admin" || role === "accountant" || role === "installer" || role === "measurement" || role === "personnel") && (
                        <button
                            onClick={handleCancelAppointment}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-rose-100 dark:border-rose-900/30 text-rose-500 hover:bg-rose-50 transition font-bold text-sm"
                        >
                            <XCircle className="w-4 h-4" /> Iptal Et
                        </button>
                    )}
                    {role === "admin" && (
                        <button
                            onClick={handleDelete}
                            className="p-3 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 hover:bg-rose-100 transition shadow-sm"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                    )}
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-[40px] border border-slate-100 dark:border-slate-800 shadow-xl shadow-slate-200/40 dark:shadow-none overflow-hidden">
                <div className="bg-slate-900 p-8 md:p-12 text-white relative">
                    <div className="relative z-10 flex flex-col md:flex-row justify-between items-start gap-6">
                        <div>
                            <div className="flex items-center gap-2 text-primary-400 text-sm font-black uppercase tracking-widest mb-3">
                                <Calendar className="w-4 h-4" />
                                {row.type === "measurement" ? "Olcu Randevusu" : "Montaj Randevusu"}
                            </div>
                            <h1 className="text-4xl md:text-5xl font-black">{customerData?.name || "İsimsiz"}</h1>
                        </div>
                        <div className="px-6 py-2.5 rounded-2xl text-xs font-black tracking-widest shadow-xl bg-primary-600">
                            {row.status?.toUpperCase()}
                        </div>
                    </div>
                </div>

                <div className="p-8 md:p-12 grid grid-cols-1 lg:grid-cols-12 gap-12">
                    <div className="lg:col-span-5 space-y-8">
                        <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-3xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center text-primary-600">
                                <Phone className="w-7 h-7" />
                            </div>
                            <div>
                                <div className="text-xs text-slate-400 font-bold uppercase mb-1">Musteri Hatti</div>
                                <a href={`tel:${customerData?.phone || ""}`} className="text-xl font-black text-slate-900 dark:text-white">
                                    {customerData?.phone || "Numara yok"}
                                </a>
                            </div>
                        </div>

                        <div className="flex items-start gap-5">
                            <div className="w-14 h-14 rounded-3xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-emerald-600">
                                <MapPin className="w-7 h-7" />
                            </div>
                            <div className="flex-1">
                                <div className="text-xs text-slate-400 font-bold uppercase mb-1">Hizmet Adresi</div>
                                {isEditMode ? (
                                    <textarea
                                        value={editAddress}
                                        onChange={(e) => setEditAddress(e.target.value)}
                                        className="w-full mt-2 p-4 rounded-2xl bg-slate-50 border-2 border-primary-100 outline-none focus:border-primary-500 transition-all font-medium text-sm"
                                        rows={3}
                                    />
                                ) : (
                                    <div className="text-lg font-bold text-slate-700 dark:text-slate-300 leading-tight">
                                        {row.address || "Adres detayi girilmemis."}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-start gap-5 pt-6 border-t border-slate-50 dark:border-slate-800">
                            <div className="w-14 h-14 rounded-3xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center text-amber-600">
                                <Clock className="w-7 h-7" />
                            </div>
                            <div className="flex-1">
                                <div className="text-xs text-slate-400 font-bold uppercase mb-1">Randevu Zamani</div>
                                {isEditMode ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                                        <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="p-3 rounded-xl border-2 border-primary-100 w-full" />
                                        <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} className="p-3 rounded-xl border-2 border-primary-100 w-full" />
                                    </div>
                                ) : (
                                    <>
                                        <div className="text-xl font-black text-slate-900 dark:text-white">
                                            {row.start_at ? new Date(row.start_at).toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" }) : "-"}
                                        </div>
                                        <div className="text-md font-bold text-primary-600 mt-1">
                                            {row.start_at ? new Date(row.start_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "-"}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4">
                            <div className="text-xs text-slate-400 font-bold uppercase mb-1">Atanan Personel</div>
                            {isEditMode ? (
                                <select
                                    ref={editAssignedRef}
                                    value={editAssignedTo}
                                    onChange={(e) => setEditAssignedTo(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900"
                                >
                                    <option value="">Personel secilmedi</option>
                                    {staffList.map((staff) => (
                                        <option key={staff.id} value={staff.id}>
                                            {staff.full_name} ({roleLabel(staff.role)})
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <div className="font-semibold text-slate-700 dark:text-slate-200">{assignedName || "Personel secilmedi"}</div>
                            )}
                        </div>

                        {isEditMode && (
                            <div className="flex gap-3">
                                <button
                                    onClick={handleUpdateAppointment}
                                    disabled={saving}
                                    className="flex-1 bg-primary-600 text-white p-4 rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg"
                                >
                                    <Save className="w-5 h-5" /> {saving ? "Guncelleniyor..." : "Bilgileri Kaydet"}
                                </button>
                                <button onClick={() => setIsEditMode(false)} className="px-6 bg-slate-100 text-slate-600 p-4 rounded-2xl font-black">
                                    Vazgec
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="lg:col-span-7 bg-slate-50 dark:bg-slate-800/40 rounded-[32px] p-8 space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-slate-900 dark:text-white font-black text-xl">
                                <ClipboardList className="w-6 h-6 text-primary-600" />
                                Olcu ve Notlar
                            </div>
                            {row.status === "measured" && (
                                <span className="text-[10px] bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-bold">Olcu alindi</span>
                            )}
                        </div>

                        <textarea
                            value={mNotes}
                            onChange={(e) => setMNotes(e.target.value)}
                            placeholder="Musterinin ozel istekleri, detayli olculer, perde turu vb."
                            className="w-full h-56 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl p-6 text-base outline-none focus:border-primary-500 transition-all font-medium leading-relaxed"
                        />

                        {row.status !== "cancelled" && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                                <button
                                    onClick={handleSaveMeasurementOnly}
                                    disabled={saving}
                                    className="bg-slate-900 hover:bg-black text-white px-6 py-4 rounded-2xl font-black shadow-lg transition-all flex items-center justify-center gap-3"
                                >
                                    <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                                    Olcuyu Kaydet
                                </button>

                                <button
                                    onClick={() =>
                                        nav("/orders/new", {
                                            state: {
                                                fromAppointment: true,
                                                appointmentId: row.id,
                                                customerId: row.customer_id,
                                                customerName: customerData?.name,
                                                phone: customerData?.phone,
                                                address: isEditMode ? editAddress : row.address,
                                                measurementNotes: mNotes,
                                                assignedTo: isEditMode ? editAssignedTo : row.assigned_to,
                                            },
                                        })
                                    }
                                    className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-4 rounded-2xl font-black shadow-lg shadow-orange-500/20 transition-all flex items-center justify-center gap-3"
                                >
                                    Siparise Donustur
                                </button>
                            </div>
                        )}

                        {row.status === "cancelled" && (
                            <div className="p-6 bg-rose-50 border border-rose-100 rounded-3xl text-center">
                                <div className="text-rose-600 font-black text-lg mb-1">Bu randevu iptal edilmistir</div>
                                <div className="text-rose-400 text-sm">Uzerinde islem yapilamaz.</div>
                            </div>
                        )}

                        <p className="text-[10px] text-slate-400 text-center italic mt-2">
                            Bilgileri guncelledikten sonra siparise donustur derseniz guncel veriler aktarilir.
                        </p>
                    </div>
                </div>
            </div>

            {row.note && (
                <div className="bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800/50 p-8 rounded-[40px] flex items-start gap-5">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0">
                        <AlertCircle className="w-6 h-6" />
                    </div>
                    <div>
                        <div className="text-indigo-800 dark:text-indigo-400 font-black mb-1">Musteri / Yönetici Notu</div>
                        <div className="text-indigo-900 dark:text-indigo-200 text-sm font-medium leading-relaxed">{row.note}</div>
                    </div>
                </div>
            )}
        </div>
    );
}
