import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { X, Check, Bell, LifeBuoy } from "lucide-react";
import { CompanySettingsCard } from "../components/CompanySettingsCard";
import { LicenseCard } from "../components/LicenseCard";

type MyTicket = {
    id: string;
    title: string | null;
    status: string | null;
    admin_response?: string | null;
    created_at: string | null;
};

const TICKET_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
    open: { label: "Yeni Talep", cls: "bg-blue-100 text-blue-700" },
    in_progress: { label: "İnceleniyor", cls: "bg-amber-100 text-amber-700" },
    waiting_user: { label: "Sizden Bilgi Bekleniyor", cls: "bg-orange-100 text-orange-700" },
    update_ready: { label: "Güncelleme Hazır", cls: "bg-violet-100 text-violet-700" },
    resolved: { label: "Çözüldü", cls: "bg-emerald-100 text-emerald-700" },
    closed: { label: "Kapatıldı", cls: "bg-slate-100 text-slate-600" },
};
import { normalizeRole, type RoleState } from "../auth/roles";
import {
    ensureNotificationPermission,
    getNotificationSettings,
    REMINDER_OPTIONS,
    saveNotificationSettings,
    type ReminderOffset,
} from "../utils/localNotifications";

export const Settings = () => {
    const navigate = useNavigate();
    const [role, setRole] = useState<RoleState>("unknown");
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [notificationSettings, setNotificationSettings] = useState(() => getNotificationSettings());
    const [myTickets, setMyTickets] = useState<MyTicket[]>([]);
    const [ticketsLoading, setTicketsLoading] = useState(false);

    useEffect(() => {
        async function loadProfile() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: profile } = await supabase
                .from("profiles")
                .select("role")
                .eq("user_id", user.id)
                .maybeSingle();

            setRole(normalizeRole(profile?.role));
        }
        loadProfile();
    }, []);

    // Kullanıcının kendi destek talepleri — iç not (internal_note) ASLA seçilmez
    useEffect(() => {
        let alive = true;
        async function loadMyTickets() {
            setTicketsLoading(true);
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const { data, error: ticketError } = await supabase
                    .from("support_tickets")
                    .select("id, title, status, admin_response, created_at")
                    .eq("user_id", user.id)
                    .order("created_at", { ascending: false })
                    .limit(20);
                let ticketData = data;
                if (ticketError) {
                    // admin_response kolonu henüz yoksa onsuz dene
                    const fb = await supabase
                        .from("support_tickets")
                        .select("id, title, status, created_at")
                        .eq("user_id", user.id)
                        .order("created_at", { ascending: false })
                        .limit(20);
                    ticketData = fb.data as any;
                }
                if (alive) setMyTickets((ticketData ?? []) as MyTicket[]);
            } catch {
                // destek tablosu yoksa bölüm boş kalır
            } finally {
                if (alive) setTicketsLoading(false);
            }
        }
        loadMyTickets();
        return () => { alive = false; };
    }, []);

    async function handleLogout() {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
    }

    function updateNotificationSettings(next: typeof notificationSettings) {
        setNotificationSettings(next);
        saveNotificationSettings(next);
        setMessage({ type: "success", text: "Bildirim ayarları kaydedildi." });
    }

    async function handleRequestNotificationPermission() {
        const allowed = await ensureNotificationPermission();
        setMessage({
            type: allowed ? "success" : "error",
            text: allowed ? "Bildirim izni aktif." : "Bildirim izni verilmedi. Telefon ayarlarından izin vermeniz gerekir.",
        });
    }

    return (
        <div className="mx-auto max-w-4xl space-y-6 pb-24">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Ayarlar</h1>
                <p className="text-slate-500 dark:text-slate-400 mt-1">Uygulama tercihlerinizi ve kurumsal kimliğinizi yönetin.</p>
            </div>

            {message && (
                <div className={`p-4 rounded-xl flex items-center gap-3 ${
                    message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200' : 'bg-red-50 text-red-700 border border-red-100 dark:bg-red-950/30 dark:text-red-200'
                }`}>
                    {message.type === 'success' ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
                    <span className="text-sm font-medium">{message.text}</span>
                </div>
            )}

            {/* Company Settings Card */}
            <CompanySettingsCard />

            {/* License Card */}
            <LicenseCard />

            {/* Profile & Personal Settings */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">

                {/* PROFIL */}
                <div className="border-b border-slate-100 p-6 dark:border-slate-800 sm:p-8">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Profil Ayarları</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Kişisel bilgilerinizi ve şifrenizi güncelleyin.</p>
                    <div className="mt-6 flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-700 dark:text-primary-300 font-bold text-xl">
                            {role ? role.charAt(0).toUpperCase() : '?'}
                        </div>
                        <div>
                            <p className="font-medium text-slate-900 dark:text-white">Oturum Açan Rol</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">{role || 'Yükleniyor...'}</p>
                        </div>
                    </div>
                </div>

                {/* NOTIFICATIONS */}
                <div className="border-b border-slate-100 p-6 dark:border-slate-800 sm:p-8">
                    <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <Bell className="h-5 w-5 text-primary-600" />
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Bildirimler</h3>
                            </div>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                Randevu, ölçü, montaj ve tahsilat hatırlatmaları telefon kilitliyken de planlanır.
                            </p>
                        </div>
                        <label className="inline-flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold dark:border-slate-800 dark:bg-slate-800/50">
                            <input
                                type="checkbox"
                                checked={notificationSettings.enabled}
                                onChange={(e) => updateNotificationSettings({ ...notificationSettings, enabled: e.target.checked })}
                                className="h-5 w-5 accent-primary-600"
                            />
                            Bildirimleri aç
                        </label>
                    </div>

                    <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto]">
                        <div>
                            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Varsayılan hatırlatma süresi</label>
                            <select
                                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-primary-400 dark:border-slate-800 dark:bg-slate-900"
                                value={notificationSettings.defaultReminderOffset}
                                onChange={(e) => updateNotificationSettings({ ...notificationSettings, defaultReminderOffset: e.target.value as ReminderOffset })}
                            >
                                {REMINDER_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <button
                            type="button"
                            onClick={handleRequestNotificationPermission}
                            className="self-end rounded-xl bg-primary-600 px-5 py-3 text-sm font-black text-white hover:bg-primary-700"
                        >
                            Bildirim izni iste
                        </button>
                    </div>
                </div>

                {/* THEME */}
                <div className="border-b border-slate-100 p-6 dark:border-slate-800 sm:p-8">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Görünüm</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Koyu mod/Açık mod tercihlerinizi belirleyin.</p>
                    <div className="mt-4 flex gap-4">
                         <div className="flex-1 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-center text-sm text-slate-500">
                            Sistem teması otomatik algılanmaktadır.
                         </div>
                    </div>
                </div>

                {/* SUPPORT TICKETS */}
                <div className="border-b border-slate-100 p-6 dark:border-slate-800 sm:p-8">
                    <div className="flex items-center gap-2">
                        <LifeBuoy className="h-5 w-5 text-primary-600" />
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Destek Taleplerim</h3>
                    </div>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Gönderdiğiniz destek taleplerinin durumunu buradan takip edebilirsiniz.
                    </p>
                    <div className="mt-4 space-y-2">
                        {ticketsLoading ? (
                            <div className="text-sm text-slate-400">Yükleniyor...</div>
                        ) : myTickets.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400 dark:border-slate-700">
                                Henüz destek talebiniz yok. Sol menüdeki "Sorun Bildir" ile talep oluşturabilirsiniz.
                            </div>
                        ) : (
                            myTickets.map((t) => {
                                const st = TICKET_STATUS_LABELS[String(t.status || "open")] ?? TICKET_STATUS_LABELS.open;
                                return (
                                    <div key={t.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="min-w-0 font-bold text-sm text-slate-800 dark:text-slate-200 truncate">{t.title || "Destek talebi"}</div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${st.cls}`}>{st.label}</span>
                                                {t.created_at && (
                                                    <span className="text-[11px] text-slate-400">{new Date(t.created_at).toLocaleDateString("tr-TR")}</span>
                                                )}
                                            </div>
                                        </div>
                                        {t.admin_response && (
                                            <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
                                                <span className="font-bold">Destek yanıtı:</span> {t.admin_response}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* LOGOUT */}
                <div className="bg-slate-50/50 p-6 dark:bg-slate-800/20 sm:p-8">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h3 className="text-lg font-semibold text-red-600">Oturumu Kapat</h3>
                            <p className="text-sm text-slate-500 mt-1">Mevcut oturumu güvenli bir şekilde sonlandırın.</p>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="w-full rounded-xl bg-white border border-red-200 px-6 py-3 text-red-600 hover:bg-red-50 font-medium transition-all shadow-sm sm:w-auto sm:py-2.5"
                        >
                            Çıkış Yap
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};
