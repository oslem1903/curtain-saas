import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { Upload, X, Check, Loader2, Bell, LifeBuoy } from "lucide-react";

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
    const [companyId, setCompanyId] = useState<string | null>(null);
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
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

            const { data: member } = await supabase
                .from("company_members")
                .select("company_id")
                .eq("user_id", user.id)
                .maybeSingle();

            if (member?.company_id) {
                setCompanyId(member.company_id);
                const { data: company } = await supabase
                    .from("companies")
                    .select("logo_url")
                    .eq("id", member.company_id)
                    .maybeSingle();
                
                setLogoUrl(company?.logo_url || null);
            }
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
                let { data, error } = await supabase
                    .from("support_tickets")
                    .select("id, title, status, admin_response, created_at")
                    .eq("user_id", user.id)
                    .order("created_at", { ascending: false })
                    .limit(20);
                if (error) {
                    // admin_response kolonu henüz yoksa onsuz dene
                    const fb = await supabase
                        .from("support_tickets")
                        .select("id, title, status, created_at")
                        .eq("user_id", user.id)
                        .order("created_at", { ascending: false })
                        .limit(20);
                    data = fb.data as any;
                }
                if (alive) setMyTickets((data ?? []) as MyTicket[]);
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

    // Logoyu küçültüp data-URL'e çevirir (storage gerektirmeyen kalıcı yöntem)
    function fileToResizedDataUrl(file: File, maxSize = 512): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.round(img.width * scale);
                    canvas.height = Math.round(img.height * scale);
                    const ctx = canvas.getContext("2d");
                    if (!ctx) { reject(new Error("canvas yok")); return; }
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL("image/png"));
                };
                img.onerror = () => reject(new Error("görsel okunamadı"));
                img.src = String(reader.result);
            };
            reader.onerror = () => reject(new Error("dosya okunamadı"));
            reader.readAsDataURL(file);
        });
    }

    async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
        try {
            setUploading(true);
            setMessage(null);

            if (!e.target.files || e.target.files.length === 0) return;
            const file = e.target.files[0];

            if (file.size > 5 * 1024 * 1024) {
                setMessage({ type: 'error', text: 'Dosya çok büyük. Lütfen 5MB altında bir görsel seçin.' });
                return;
            }

            let logoValue: string | null = null;

            // 1. Önce Supabase Storage dene
            try {
                const fileExt = file.name.split('.').pop();
                const filePath = `${companyId}-logo.${fileExt}`;
                const { error: uploadError } = await supabase.storage
                    .from('logos')
                    .upload(filePath, file, { upsert: true });
                if (!uploadError) {
                    const { data: { publicUrl } } = supabase.storage
                        .from('logos')
                        .getPublicUrl(filePath);
                    // Cache kırmak için sürüm parametresi ekle
                    logoValue = `${publicUrl}?v=${Date.now()}`;
                }
            } catch {
                // storage erişilemiyor — aşağıdaki yedek yöntem devreye girer
            }

            // 2. Storage başarısızsa: küçültülmüş base64 olarak kaydet (her zaman çalışır)
            if (!logoValue) {
                logoValue = await fileToResizedDataUrl(file);
            }

            const { error: updateError } = await supabase
                .from('companies')
                .update({ logo_url: logoValue })
                .eq('id', companyId);

            if (updateError) throw updateError;

            setLogoUrl(logoValue);
            setMessage({ type: 'success', text: 'Logo başarıyla güncellendi.' });
        } catch {
            setMessage({ type: 'error', text: 'Logo kaydedilemedi. Lütfen farklı bir görselle tekrar deneyin.' });
        } finally {
            setUploading(false);
        }
    }

    async function handleRemoveLogo() {
        try {
            setUploading(true);
            const { error } = await supabase
                .from('companies')
                .update({ logo_url: null })
                .eq('id', companyId);

            if (error) throw error;
            setLogoUrl(null);
            setMessage({ type: 'success', text: 'Logo kaldırıldı.' });
        } catch {
            setMessage({ type: 'error', text: 'Logo kaldırılamadı. Lütfen tekrar deneyin.' });
        } finally {
            setUploading(false);
        }
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

    const isAdmin = role === "admin";

    return (
        <div className="mx-auto max-w-4xl space-y-6 pb-24">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Ayarlar</h1>
                <p className="text-slate-500 dark:text-slate-400 mt-1">Uygulama tercihlerinizi ve kurumsal kimliğinizi yönetin.</p>
            </div>

            {message && (
                <div className={`p-4 rounded-xl flex items-center gap-3 ${
                    message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'
                }`}>
                    {message.type === 'success' ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
                    <span className="text-sm font-medium">{message.text}</span>
                </div>
            )}

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                
                {/* LOGO AYARLARI (Sadece Admin) */}
                {isAdmin && (
                    <div className="border-b border-slate-100 p-6 dark:border-slate-800 sm:p-8">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Kurumsal Logo</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                    Sistem genelinde ve raporlarda görünecek şirket logonuzu yükleyin.
                                </p>
                            </div>
                            
                            <div className="flex flex-col items-center gap-4">
                                <div className="relative group">
                                    <div className="w-32 h-32 rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden transition-all group-hover:border-primary-400">
                                        {logoUrl ? (
                                            <img src={logoUrl} alt="Company Logo" className="w-full h-full object-contain p-2" />
                                        ) : (
                                            <Upload className="w-8 h-8 text-slate-400" />
                                        )}
                                        {uploading && (
                                            <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 flex items-center justify-center backdrop-blur-sm">
                                                <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
                                            </div>
                                        )}
                                    </div>
                                    
                                    {logoUrl && !uploading && (
                                        <button 
                                            onClick={handleRemoveLogo}
                                            className="absolute -top-2 -right-2 p-1.5 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors shadow-sm"
                                            title="Logoyu Kaldır"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>

                                <label className="relative cursor-pointer bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm flex items-center gap-2">
                                    <Upload className="w-4 h-4" />
                                    {logoUrl ? 'Logoyu Değiştir' : 'Logo Yükle'}
                                    <input 
                                        type="file" 
                                        className="hidden" 
                                        accept="image/*" 
                                        onChange={handleLogoUpload} 
                                        disabled={uploading}
                                    />
                                </label>
                                <p className="text-[11px] text-slate-400">PNG, JPG veya SVG (Önerilen: Kare, max 2MB)</p>
                            </div>
                        </div>
                    </div>
                )}

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

                {/* GORUNUM */}
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

                {/* GORUNUM */}
                <div className="border-b border-slate-100 p-6 dark:border-slate-800 sm:p-8">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Görünüm</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Koyu mod/Açık mod tercihlerinizi belirleyin.</p>
                    <div className="mt-4 flex gap-4">
                         <div className="flex-1 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-center text-sm text-slate-500">
                            Sistem teması otomatik algılanmaktadır.
                         </div>
                    </div>
                </div>

                {/* DESTEK TALEPLERIM */}
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

                {/* CIKIS */}
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
