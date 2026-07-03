import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
    Building2,
    ChevronLeft,
    Clock,
    Eye,
    HardDrive,
    Lock,
    RotateCw,
    Users,
    AlertTriangle,
    CheckCircle2,
    Zap,
} from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { supabase, setDemoTenantContext } from "../supabaseClient";
import { cn } from "../utils/cn";

type Tab = "ozet" | "destek" | "cihazlar" | "hatalar" | "yedeklemeler";

type CompanyDetail = {
    id: string;
    name: string;
    subscription_plan: string;
    plan_status: "active" | "trial" | "expired" | "suspended";
    is_active: boolean;
    trial_end: string | null;
    trial_ends_at: string | null;
    max_users: number | null;
    max_devices: number | null;
    enabled_modules: string[];
    created_at: string;
    owner_id: string;
};

type CompanyStats = {
    user_count: number;
    device_count: number;
    active_devices: number;
    open_tickets: number;
    error_count: number;
    last_error_at: string | null;
    last_login: string | null;
    last_backup: string | null;
};

type SupportTicket = {
    id: string;
    title: string;
    status: string;
    priority: string;
    created_at: string;
};

type CompanyDevice = {
    id: string;
    device_name: string | null;
    browser_name: string | null;
    os_name: string | null;
    last_seen_at: string | null;
    is_active: boolean;
};

type ErrorLog = {
    id: string;
    message: string;
    created_at: string;
    app_version: string;
};

type BackupRecord = {
    id: string;
    backup_type: string;
    status: string;
    created_at: string;
    completed_at: string | null;
};

export default function SuperAdminFirmaDetay() {
    const nav = useNavigate();
    const { companyId } = useParams<{ companyId: string }>();

    const [activeTab, setActiveTab] = useState<Tab>("ozet");
    const [company, setCompany] = useState<CompanyDetail | null>(null);
    const [stats, setStats] = useState<CompanyStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [devices, setDevices] = useState<CompanyDevice[]>([]);
    const [errors, setErrors] = useState<ErrorLog[]>([]);
    const [backups, setBackups] = useState<BackupRecord[]>([]);

    const [demoSessionActive, setDemoSessionActive] = useState(false);
    const [demoCountdown, setDemoCountdown] = useState(300); // 5 minutes
    const [performingAction, setPerformingAction] = useState<string | null>(null);

    useEffect(() => {
        if (!companyId) return;
        loadCompanyDetails();
    }, [companyId]);

    // Demo session countdown
    useEffect(() => {
        if (!demoSessionActive) return;

        const timer = setInterval(() => {
            setDemoCountdown((prev) => {
                if (prev <= 1) {
                    setDemoSessionActive(false);
                    localStorage.removeItem("demo_company_id");
                    localStorage.removeItem("demo_read_only");
                    return 300;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [demoSessionActive]);

    async function loadCompanyDetails() {
        if (!companyId) return;

        setLoading(true);
        setError("");
        try {
            // Load company
            const { data: comp, error: compErr } = await supabase
                .from("companies")
                .select("*")
                .eq("id", companyId)
                .maybeSingle();

            if (compErr || !comp) throw new Error("Firma bulunamadı");
            setCompany(comp);

            // Load stats in parallel
            const [userCount, deviceCount, activeDevices, openTickets, lastError, lastLogin, lastBackup] =
                await Promise.all([
                    supabase
                        .from("company_members")
                        .select("*", { count: "exact", head: true })
                        .eq("company_id", companyId),
                    supabase
                        .from("company_devices")
                        .select("*", { count: "exact", head: true })
                        .eq("company_id", companyId),
                    supabase
                        .from("company_devices")
                        .select("*", { count: "exact", head: true })
                        .eq("company_id", companyId)
                        .eq("is_active", true),
                    supabase
                        .from("support_tickets")
                        .select("*", { count: "exact", head: true })
                        .eq("company_id", companyId)
                        .in("status", ["open", "in_progress"]),
                    supabase
                        .from("error_logs")
                        .select("created_at")
                        .eq("company_id", companyId)
                        .order("created_at", { ascending: false })
                        .limit(1),
                    supabase
                        .from("company_devices")
                        .select("last_seen_at")
                        .eq("company_id", companyId)
                        .order("last_seen_at", { ascending: false })
                        .limit(1),
                    supabase
                        .from("backup_history")
                        .select("created_at")
                        .eq("company_id", companyId)
                        .eq("status", "completed")
                        .order("created_at", { ascending: false })
                        .limit(1),
                ]);

            setStats({
                user_count: userCount.count || 0,
                device_count: deviceCount.count || 0,
                active_devices: activeDevices.count || 0,
                open_tickets: openTickets.count || 0,
                error_count: lastError.data?.length || 0,
                last_error_at: lastError.data?.[0]?.created_at || null,
                last_login: lastLogin.data?.[0]?.last_seen_at || null,
                last_backup: lastBackup.data?.[0]?.created_at || null,
            });

            // Load tab data based on active tab
            await loadTabData(companyId);
        } catch (e: any) {
            setError(e?.message || "Firma yüklenirken hata oluştu");
        } finally {
            setLoading(false);
        }
    }

    async function loadTabData(id: string) {
        try {
            switch (activeTab) {
                case "destek": {
                    const { data } = await supabase
                        .from("support_tickets")
                        .select("id, title, status, priority, created_at")
                        .eq("company_id", id)
                        .order("created_at", { ascending: false })
                        .limit(10);
                    setTickets(data || []);
                    break;
                }
                case "cihazlar": {
                    const { data } = await supabase
                        .from("company_devices")
                        .select("id, device_name, browser_name, os_name, last_seen_at, is_active")
                        .eq("company_id", id)
                        .order("last_seen_at", { ascending: false });
                    setDevices(data || []);
                    break;
                }
                case "hatalar": {
                    const { data } = await supabase
                        .from("error_logs")
                        .select("id, message, created_at, app_version")
                        .eq("company_id", id)
                        .order("created_at", { ascending: false })
                        .limit(20);
                    setErrors(data || []);
                    break;
                }
                case "yedeklemeler": {
                    const { data } = await supabase
                        .from("backup_history")
                        .select("id, backup_type, status, created_at, completed_at")
                        .eq("company_id", id)
                        .order("created_at", { ascending: false })
                        .limit(15);
                    setBackups(data || []);
                    break;
                }
            }
        } catch (e: any) {
            console.error("Tab veri yükleme hatası:", e?.message);
        }
    }

    async function handleDemoSession() {
        if (!company) return;

        setPerformingAction("demo");
        try {
            // Call RPC to create session
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { data, error } = await supabase.rpc("super_admin_start_impersonate_session", {
                p_target_company_id: company.id,
                p_target_role: "admin",
                p_duration_minutes: 5,
            });

            if (error) throw error;

            // Set demo context
            setDemoTenantContext(company.id, false); // false = write enabled for testing
            setDemoSessionActive(true);
            setDemoCountdown(300);
        } catch (e: any) {
            alert("Demo oturumu başlatılamadı: " + (e?.message || "Bilinmeyen hata"));
        } finally {
            setPerformingAction(null);
        }
    }

    async function handleCacheClear() {
        if (!company) return;

        setPerformingAction("cache");
        try {
            const { error } = await supabase.rpc("super_admin_execute_remote_action", {
                p_company_id: company.id,
                p_operation_type: "cache_clear",
                p_parameters: {},
            });

            if (error) throw error;
            alert("Cache başarıyla temizlendi");
        } catch (e: any) {
            alert("Cache temizlenirken hata: " + (e?.message || "Bilinmeyen hata"));
        } finally {
            setPerformingAction(null);
        }
    }

    async function handleHealthCheck() {
        if (!company) return;

        setPerformingAction("health");
        try {
            const { error } = await supabase.rpc("trigger_company_database_health_check", {
                p_company_id: company.id,
            });

            if (error) throw error;
            alert("Veritabanı sağlık kontrolü yapıldı");
        } catch (e: any) {
            alert("Sağlık kontrolü hatası: " + (e?.message || "Bilinmeyen hata"));
        } finally {
            setPerformingAction(null);
        }
    }

    if (loading)
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-slate-600">Firma yükleniyor...</div>
            </div>
        );

    if (!company)
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-4">
                <AlertTriangle size={48} className="text-red-500" />
                <div className="text-slate-600">{error || "Firma bulunamadı"}</div>
                <button
                    onClick={() => nav(-1)}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-black hover:bg-slate-50"
                >
                    Geri Dön
                </button>
            </div>
        );

    const planBadgeColor =
        company.plan_status === "active"
            ? "bg-emerald-100 text-emerald-700"
            : company.plan_status === "trial"
              ? "bg-blue-100 text-blue-700"
              : "bg-red-100 text-red-700";

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-6 flex items-center justify-between">
                    <button
                        onClick={() => nav(-1)}
                        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                        <ChevronLeft size={20} />
                        <span className="text-sm font-black">Geri</span>
                    </button>
                </div>

                {/* Company Header Card */}
                <div className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                    <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="flex items-start gap-4">
                            <div className="h-16 w-16 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                                <Building2 size={32} className="text-blue-600" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black text-slate-900 dark:text-white">{company.name}</h1>
                                <div className="flex items-center gap-2 mt-2">
                                    <span
                                        className={cn(
                                            "rounded-full px-3 py-1 text-xs font-black uppercase tracking-widest",
                                            planBadgeColor
                                        )}
                                    >
                                        {company.plan_status}
                                    </span>
                                    <span className="text-sm text-slate-600 dark:text-slate-400">
                                        {company.subscription_plan}
                                    </span>
                                    {!company.is_active && (
                                        <span className="text-xs font-black text-red-600 dark:text-red-400">
                                            [PASİF]
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-wrap gap-2 justify-end">
                            <button
                                onClick={handleDemoSession}
                                disabled={performingAction === "demo" || demoSessionActive}
                                className="flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-60"
                                title={
                                    demoSessionActive
                                        ? `Demo aktif (${Math.floor(demoCountdown / 60)}:${String(demoCountdown % 60).padStart(2, "0")})`
                                        : ""
                                }
                            >
                                <Eye size={16} />
                                Demo İzle
                            </button>
                            <button
                                onClick={handleCacheClear}
                                disabled={performingAction === "cache"}
                                className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-black text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                            >
                                <RotateCw size={16} />
                                Cache Temizle
                            </button>
                            <button
                                onClick={handleHealthCheck}
                                disabled={performingAction === "health"}
                                className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-black text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                            >
                                <Zap size={16} />
                                Sağlık Kontrolü
                            </button>
                        </div>
                    </div>

                    {/* Trial Info */}
                    {company.plan_status === "trial" && (company.trial_end || company.trial_ends_at) && (
                        <div className="mt-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3">
                            <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                                Deneme süresi:{" "}
                                {format(new Date(company.trial_end || company.trial_ends_at!), "d MMMM yyyy", {
                                    locale: tr,
                                })}
                            </p>
                        </div>
                    )}
                </div>

                {/* Stats Grid */}
                {stats && (
                    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <StatCard
                            icon={<Users size={20} />}
                            label="Aktif Kullanıcı"
                            value={stats.user_count}
                            max={company.max_users}
                        />
                        <StatCard
                            icon={<HardDrive size={20} />}
                            label="Cihaz"
                            value={stats.active_devices}
                            max={company.max_devices}
                            subtext={`${stats.device_count} toplam`}
                        />
                        <StatCard
                            icon={<AlertTriangle size={20} />}
                            label="Açık Hata"
                            value={stats.error_count}
                            className={stats.error_count > 0 ? "text-red-600" : ""}
                        />
                        <StatCard
                            icon={<Clock size={20} />}
                            label="Son Giriş"
                            value={stats.last_login ? format(new Date(stats.last_login), "HH:mm") : "-"}
                            subtext={stats.last_login ? format(new Date(stats.last_login), "d MMM", { locale: tr }) : ""}
                        />
                    </div>
                )}

                {/* Tab Navigation */}
                <div className="mb-6 flex gap-2 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
                    {(["ozet", "destek", "cihazlar", "hatalar", "yedeklemeler"] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => {
                                setActiveTab(tab);
                                loadTabData(company.id);
                            }}
                            className={cn(
                                "px-4 py-2 text-sm font-black whitespace-nowrap border-b-2 transition",
                                activeTab === tab
                                    ? "border-blue-600 text-blue-600 dark:text-blue-400"
                                    : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                            )}
                        >
                            {tab === "ozet" && "Özet"}
                            {tab === "destek" && "Destek Talepleri"}
                            {tab === "cihazlar" && "Cihazlar"}
                            {tab === "hatalar" && "Hata Logları"}
                            {tab === "yedeklemeler" && "Yedeklemeler"}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                    {activeTab === "ozet" && (
                        <div className="grid grid-cols-1 gap-4">
                            <div className="grid grid-cols-2 gap-4">
                                <InfoItem label="Oluşturma Tarihi" value={format(new Date(company.created_at), "d MMMM yyyy", { locale: tr })} />
                                <InfoItem label="Paket" value={company.subscription_plan || "-"} />
                                <InfoItem label="Modüller" value={company.enabled_modules?.length || 0} />
                                <InfoItem label="Maksimum Kullanıcı" value={company.max_users || "Sınırsız"} />
                            </div>
                        </div>
                    )}

                    {activeTab === "destek" && (
                        <div className="space-y-3">
                            {tickets.length === 0 ? (
                                <p className="text-slate-500">Açık destek talebesi yok</p>
                            ) : (
                                tickets.map((ticket) => (
                                    <div key={ticket.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                                        <div className="flex items-start justify-between gap-2 mb-1">
                                            <p className="font-medium text-slate-900 dark:text-white">{ticket.title}</p>
                                            <span className="text-xs font-black text-slate-500 whitespace-nowrap">
                                                {format(new Date(ticket.created_at), "d MMM HH:mm", { locale: tr })}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-600 dark:text-slate-400">
                                            Status: {ticket.status} • Öncelik: {ticket.priority}
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {activeTab === "cihazlar" && (
                        <div className="space-y-3">
                            {devices.length === 0 ? (
                                <p className="text-slate-500">Cihaz kaydı yok</p>
                            ) : (
                                devices.map((device) => (
                                    <div key={device.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <div>
                                                <p className="font-medium text-slate-900 dark:text-white">
                                                    {device.device_name || "Bilinmeyen Cihaz"}
                                                </p>
                                                <p className="text-xs text-slate-600 dark:text-slate-400">
                                                    {device.browser_name} • {device.os_name}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {device.is_active ? (
                                                    <CheckCircle2 size={16} className="text-emerald-600" />
                                                ) : (
                                                    <Lock size={16} className="text-slate-400" />
                                                )}
                                                <span className="text-xs text-slate-500">
                                                    {device.last_seen_at
                                                        ? format(new Date(device.last_seen_at), "d MMM HH:mm", { locale: tr })
                                                        : "-"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {activeTab === "hatalar" && (
                        <div className="space-y-3">
                            {errors.length === 0 ? (
                                <p className="text-slate-500">Hata kaydı yok</p>
                            ) : (
                                errors.map((err) => (
                                    <div key={err.id} className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/10 p-3">
                                        <div className="flex items-start justify-between gap-2 mb-1">
                                            <p className="font-medium text-red-700 dark:text-red-400 text-sm">{err.message}</p>
                                            <span className="text-xs text-red-600 dark:text-red-500 whitespace-nowrap">
                                                {format(new Date(err.created_at), "d MMM HH:mm", { locale: tr })}
                                            </span>
                                        </div>
                                        <p className="text-xs text-red-600 dark:text-red-500">v{err.app_version}</p>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {activeTab === "yedeklemeler" && (
                        <div className="space-y-3">
                            {backups.length === 0 ? (
                                <p className="text-slate-500">Yedekleme kaydı yok</p>
                            ) : (
                                backups.map((backup) => (
                                    <div key={backup.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                            <div>
                                                <p className="font-medium text-slate-900 dark:text-white text-sm">
                                                    {backup.backup_type === "auto" && "Otomatik Yedek"}
                                                    {backup.backup_type === "manual" && "Manuel Yedek"}
                                                    {backup.backup_type === "pre_restore" && "Geri Yükleme Öncesi"}
                                                </p>
                                                <p className="text-xs text-slate-600 dark:text-slate-400">
                                                    Status:{" "}
                                                    <span
                                                        className={
                                                            backup.status === "completed"
                                                                ? "text-emerald-600"
                                                                : backup.status === "failed"
                                                                  ? "text-red-600"
                                                                  : "text-blue-600"
                                                        }
                                                    >
                                                        {backup.status}
                                                    </span>
                                                </p>
                                            </div>
                                            <span className="text-xs text-slate-500 whitespace-nowrap">
                                                {format(new Date(backup.created_at), "d MMM HH:mm", { locale: tr })}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
    max,
    subtext,
    className,
}: {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    max?: number | null;
    subtext?: string;
    className?: string;
}) {
    return (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="flex items-center gap-3 mb-2">
                <div className="text-slate-600 dark:text-slate-400">{icon}</div>
                <p className="text-sm text-slate-600 dark:text-slate-400">{label}</p>
            </div>
            <p className={cn("text-2xl font-black text-slate-900 dark:text-white", className)}>{value}</p>
            {max && <p className="text-xs text-slate-500 mt-1">Max: {max}</p>}
            {subtext && <p className="text-xs text-slate-500 mt-1">{subtext}</p>}
        </div>
    );
}

function InfoItem({ label, value }: { label: string; value: string | number }) {
    return (
        <div>
            <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1">{label}</p>
            <p className="text-sm font-medium text-slate-900 dark:text-white">{value}</p>
        </div>
    );
}
