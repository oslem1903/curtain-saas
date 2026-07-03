import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, CheckCircle2, Eye, LogIn, MonitorSmartphone, PencilLine, Plus, Power, Search, Trash2, Users } from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";

import { setDemoTenantContext, supabase } from "../supabaseClient";
import { cn } from "../utils/cn";
import { CORE_MODULES, ENTERPRISE_MODULES, PRO_MODULES, SOLO_MODULES } from "../context/AuthContext";
import ImpersonationModal from "../components/ImpersonationModal";

type CompanyStats = {
    id: string;
    name: string;
    subscription_plan: string;
    plan_status: "active" | "trial" | "expired" | "suspended" | string;
    is_active: boolean;
    read_only: boolean;
    trial_end: string | null;
    user_count: number;
    open_tickets: number;
    last_error_at: string | null;
    app_version: string;
    enabled_modules: string[];
    package_code: string;
    max_devices: number;
    active_device_count: number;
};

type CompanyDevice = {
    id: string;
    company_id: string;
    device_id: string;
    device_name: string | null;
    user_agent: string | null;
    browser_name: string | null;
    os_name: string | null;
    ip_address: string | null;
    first_seen_at: string | null;
    last_seen_at: string | null;
    is_active: boolean | null;
};

type DeviceLimitRequest = {
    id: string;
    company_id: string;
    user_id: string | null;
    title: string | null;
    status: string | null;
    created_at: string;
    support_metadata?: {
        kind?: string;
        requested_device_id?: string;
        device_name?: string;
        user_agent?: string;
    } | null;
    profile?: { full_name: string | null } | null;
};

const planLabels: Record<string, string> = {
    starter: "Başlangıç",
    pro: "Profesyonel",
    enterprise: "Kurumsal",
};

const moduleLabels: Record<string, string> = {
    admin: "Yönetici",
    measurements: "Ölçü",
    orders: "Sipariş",
    suppliers: "Tedarikçi",
    installation: "Montaj",
    accounting: "Muhasebe",
    staff: "Personel",
    vehicles: "Araç Takibi",
    commissions: "Prim Sistemi",
    warehouse: "Depo",
    catalogs: "Kartela",
    reports: "Raporlar",
    expenses: "Giderler",
    profit: "Kar",
    customers: "Müşteriler",
    appointments: "Randevular",
    branches: "Şubeler",
};

const editableModules = ["admin", "measurements", "orders", "suppliers", "installation", "accounting", "staff", "vehicles", "commissions", "warehouse", "catalogs", "reports", "expenses", "profit", "customers", "appointments", "branches"];

function modulesForPlan(plan: string) {
    if (plan === "solo") return SOLO_MODULES;
    if (plan === "pro") return PRO_MODULES;
    if (plan === "enterprise" || plan === "lifetime") return ENTERPRISE_MODULES;
    return CORE_MODULES;
}

function defaultDeviceLimit(plan: string) {
    const normalized = String(plan || "").toLowerCase();
    if (normalized === "solo" || normalized === "solo_perdeci" || normalized === "starter") return 1;
    if (normalized === "pro" || normalized === "professional" || normalized === "yonetici") return 3;
    return 3;
}

export default function SuperAdminCompanies() {
    const nav = useNavigate();
    const [companies, setCompanies] = useState<CompanyStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [savingId, setSavingId] = useState<string | null>(null);
    const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);
    const [devicesByCompany, setDevicesByCompany] = useState<Record<string, CompanyDevice[]>>({});
    const [requestsByCompany, setRequestsByCompany] = useState<Record<string, DeviceLimitRequest[]>>({});
    const [deviceLimitInputs, setDeviceLimitInputs] = useState<Record<string, string>>({});
    const [impersonationModal, setImpersonationModal] = useState<{ isOpen: boolean; companyId: string; companyName: string }>({ isOpen: false, companyId: "", companyName: "" });

    useEffect(() => {
        loadCompanies();
    }, []);

    async function loadCompanies() {
        setLoading(true);
        try {
            const { data: rows, error } = await supabase.from("companies").select("*").order("created_at", { ascending: false });
            if (error) throw error;

            const stats = await Promise.all((rows ?? []).map(async (company) => {
                const { count: userCount } = await supabase
                    .from("company_members")
                    .select("*", { count: "exact", head: true })
                    .eq("company_id", company.id);

                const { count: openTickets } = await supabase
                    .from("support_tickets")
                    .select("*", { count: "exact", head: true })
                    .eq("company_id", company.id)
                    .in("status", ["open", "in_progress"]);

                const { data: lastError } = await supabase
                    .from("error_logs")
                    .select("created_at")
                    .eq("company_id", company.id)
                    .order("created_at", { ascending: false })
                    .limit(1);

                const { count: activeDevices } = await supabase
                    .from("company_devices")
                    .select("*", { count: "exact", head: true })
                    .eq("company_id", company.id)
                    .eq("is_active", true);

                return {
                    id: company.id,
                    name: company.name || "İsimsiz Firma",
                    subscription_plan: company.subscription_plan || company.plan_type || "starter",
                    plan_status: company.plan_status || (company.is_active === false ? "suspended" : "trial"),
                    is_active: company.is_active !== false,
                    read_only: company.read_only === true,
                    trial_end: company.trial_end || company.trial_ends_at || null,
                    user_count: userCount || 0,
                    open_tickets: openTickets || 0,
                    last_error_at: lastError?.[0]?.created_at || null,
                    app_version: "1.0.0",
                    enabled_modules: Array.isArray(company.enabled_modules) ? company.enabled_modules : modulesForPlan(company.package_code || company.subscription_plan || "starter"),
                    package_code: company.package_code || (company.subscription_plan === "starter" ? "solo" : company.subscription_plan || "starter"),
                    max_devices: company.max_devices || defaultDeviceLimit(company.package_code || company.subscription_plan || "starter"),
                    active_device_count: activeDevices || 0,
                };
            }));

            setCompanies(stats);
        } catch (e: any) {
            alert(e?.message || "Firmalar yüklenemedi.");
        } finally {
            setLoading(false);
        }
    }

    async function updateCompany(id: string, patch: Record<string, unknown>) {
        setSavingId(id);
        try {
            const { error } = await supabase.from("companies").update(patch).eq("id", id);
            if (error) throw error;
            await loadCompanies();
        } catch (e: any) {
            alert(e?.message || "Firma güncellenemedi.");
        } finally {
            setSavingId(null);
        }
    }

    async function updatePlan(company: CompanyStats, plan: string) {
        await updateCompany(company.id, {
            subscription_plan: plan === "solo" ? "starter" : plan,
            package_code: plan,
            enabled_modules: modulesForPlan(plan),
            ...(plan === "enterprise" ? {} : { max_devices: defaultDeviceLimit(plan) }),
        });
    }

    async function toggleModule(company: CompanyStats, module: string) {
        const current = new Set(company.enabled_modules || []);
        if (current.has(module)) current.delete(module);
        else current.add(module);
        await updateCompany(company.id, { enabled_modules: Array.from(current) });
    }

    async function loadDeviceManagement(companyId: string) {
        const [{ data: devices, error: devicesError }, ticketsResult] = await Promise.all([
            supabase
                .from("company_devices")
                .select("id,company_id,device_id,device_name,user_agent,browser_name,os_name,ip_address,first_seen_at,last_seen_at,is_active")
                .eq("company_id", companyId)
                .order("last_seen_at", { ascending: false }),
            supabase
                .from("support_tickets")
                .select("id,company_id,user_id,title,status,created_at,support_metadata,profile:profiles(full_name)")
                .eq("company_id", companyId)
                .in("status", ["open", "in_progress"])
                .order("created_at", { ascending: false }),
        ]);

        if (devicesError) throw devicesError;

        setDevicesByCompany((prev) => ({ ...prev, [companyId]: (devices ?? []) as CompanyDevice[] }));

        if (ticketsResult.error) {
            setRequestsByCompany((prev) => ({ ...prev, [companyId]: [] }));
            return;
        }

        const requests = ((ticketsResult.data ?? []) as any[])
            .filter((ticket) => ticket.support_metadata?.kind === "device_limit" || /cihaz/i.test(String(ticket.title || "")))
            .map((ticket) => ({
                ...ticket,
                profile: Array.isArray(ticket.profile) ? ticket.profile[0] : ticket.profile,
            })) as DeviceLimitRequest[];
        setRequestsByCompany((prev) => ({ ...prev, [companyId]: requests }));
    }

    async function toggleDevicePanel(company: CompanyStats) {
        const nextId = expandedCompanyId === company.id ? null : company.id;
        setExpandedCompanyId(nextId);
        if (nextId) {
            setDeviceLimitInputs((prev) => ({ ...prev, [company.id]: String(company.max_devices) }));
            await loadDeviceManagement(company.id).catch((e: any) => alert(e?.message || "Cihaz bilgileri yuklenemedi."));
        }
    }

    async function updateDeviceLimit(company: CompanyStats) {
        const nextLimit = Number(deviceLimitInputs[company.id] || company.max_devices);
        if (!Number.isFinite(nextLimit) || nextLimit < 1) {
            alert("Cihaz limiti en az 1 olmalidir.");
            return;
        }

        setSavingId(company.id);
        try {
            const { error } = await supabase.rpc("super_admin_set_company_device_limit", {
                p_company_id: company.id,
                p_max_devices: nextLimit,
            });
            if (error) {
                const fallback = await supabase.from("companies").update({ max_devices: nextLimit }).eq("id", company.id);
                if (fallback.error) throw fallback.error;
            }
            await loadCompanies();
            await loadDeviceManagement(company.id);
        } catch (e: any) {
            alert(e?.message || "Cihaz limiti guncellenemedi.");
        } finally {
            setSavingId(null);
        }
    }

    async function setDeviceActive(companyId: string, deviceId: string, isActive: boolean) {
        setSavingId(companyId);
        try {
            const { error } = await supabase.rpc("super_admin_set_device_active", {
                p_device_id: deviceId,
                p_is_active: isActive,
            });
            if (error) {
                const fallback = await supabase.from("company_devices").update({ is_active: isActive }).eq("id", deviceId);
                if (fallback.error) throw fallback.error;
            }
            await loadCompanies();
            await loadDeviceManagement(companyId);
        } catch (e: any) {
            alert(e?.message || "Cihaz durumu guncellenemedi.");
        } finally {
            setSavingId(null);
        }
    }

    async function deleteDevice(companyId: string, deviceId: string) {
        if (!window.confirm("Bu cihazi silmek istiyor musunuz? Kullanici bu cihazdan tekrar girerse limit uygunsa yeniden kaydedilir.")) return;
        setSavingId(companyId);
        try {
            const { error } = await supabase.rpc("super_admin_delete_device", { p_device_id: deviceId });
            if (error) {
                const fallback = await supabase.from("company_devices").delete().eq("id", deviceId);
                if (fallback.error) throw fallback.error;
            }
            await loadCompanies();
            await loadDeviceManagement(companyId);
        } catch (e: any) {
            alert(e?.message || "Cihaz silinemedi.");
        } finally {
            setSavingId(null);
        }
    }

    async function approveDeviceRequest(companyId: string, ticketId: string, action: "increase_limit" | "remove_device") {
        setSavingId(companyId);
        try {
            const { error } = await supabase.rpc("super_admin_approve_device_request", {
                p_ticket_id: ticketId,
                p_action: action,
                p_remove_device_id: null,
            });
            if (error) throw error;
            await loadCompanies();
            await loadDeviceManagement(companyId);
        } catch (e: any) {
            alert(e?.message || "Talep onaylanamadi.");
        } finally {
            setSavingId(null);
        }
    }

    function openDemo(company: CompanyStats, role: "admin" | "accountant" | "installer", readOnly = true) {
        setDemoTenantContext(company.id, readOnly);
        localStorage.setItem("demo_viewing_role", role);
        localStorage.removeItem("demo_viewing_user_id");
        const target = role === "accountant" ? "/accounting" : role === "installer" ? "/route/today" : "/dashboard";
        nav(target);
    }

    const filtered = companies.filter((company) =>
        company.name.toLocaleLowerCase("tr-TR").includes(search.toLocaleLowerCase("tr-TR")),
    );

    if (loading) return <div className="p-8 text-center">Yükleniyor...</div>;

    return (
        <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white">Müşteri Firmalar</h1>
                    <p className="mt-1 text-slate-500">Lisans, paket, deneme süresi ve read-only demo yönetimi.</p>
                </div>

                <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Firma ara..."
                        className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 outline-none transition focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-800"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {filtered.map((company) => (
                    <div key={company.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                            <div className="flex min-w-0 items-start gap-4">
                                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-xl font-black text-blue-600 dark:bg-blue-900/20 dark:text-blue-300">
                                    {company.name.charAt(0).toLocaleUpperCase("tr-TR")}
                                </div>
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="truncate text-xl font-bold text-slate-900 dark:text-white">{company.name}</h3>
                                        <span className={cn(
                                            "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest",
                                            company.plan_status === "active" ? "bg-emerald-100 text-emerald-700" :
                                                company.plan_status === "trial" ? "bg-blue-100 text-blue-700" :
                                                    company.plan_status === "expired" ? "bg-amber-100 text-amber-700" :
                                                        "bg-red-100 text-red-700",
                                        )}>
                                            {company.plan_status}
                                        </span>
                                        {company.read_only ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-600">Read-only</span> : null}
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                                        <span className="flex items-center gap-1"><Building2 size={14} /> {planLabels[company.package_code] || planLabels[company.subscription_plan] || company.subscription_plan}</span>
                                        <span className="flex items-center gap-1"><MonitorSmartphone size={14} /> {company.active_device_count}/{company.max_devices} cihaz</span>
                                        <span className="flex items-center gap-1"><Users size={14} /> {company.user_count} kullanıcı</span>
                                        <span>Destek: {company.open_tickets} açık</span>
                                        <span>Son hata: {company.last_error_at ? format(new Date(company.last_error_at), "dd MMM", { locale: tr }) : "Yok"}</span>
                                        <span>Deneme bitişi: {company.trial_end ? format(new Date(company.trial_end), "dd MMM yyyy", { locale: tr }) : "Süresiz"}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
                                <select
                                    value={company.plan_status}
                                    disabled={savingId === company.id}
                                    onChange={(e) => updateCompany(company.id, {
                                        plan_status: e.target.value,
                                        is_active: e.target.value !== "suspended",
                                        read_only: e.target.value === "expired",
                                    })}
                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-800"
                                >
                                    <option value="trial">Trial</option>
                                    <option value="active">Active</option>
                                    <option value="expired">Expired</option>
                                    <option value="suspended">Suspended</option>
                                </select>
                                <select
                                    value={company.package_code || company.subscription_plan}
                                    disabled={savingId === company.id}
                                    onChange={(e) => updatePlan(company, e.target.value)}
                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-800"
                                >
                                    <option value="starter">Başlangıç</option>
                                    <option value="solo">Solo Perdeci</option>
                                    <option value="pro">Profesyonel</option>
                                    <option value="enterprise">Kurumsal</option>
                                </select>
                                <button
                                    type="button"
                                    onClick={() => updateCompany(company.id, { read_only: !company.read_only })}
                                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                                >
                                    {company.read_only ? "Yazmayı Aç" : "Read-only"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => toggleDevicePanel(company)}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                                >
                                    <MonitorSmartphone size={16} />
                                    Cihazlar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => openDemo(company, "admin", true)}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700"
                                >
                                    <Eye size={16} />
                                    Demo İzle
                                </button>
                                <button
                                    type="button"
                                    onClick={() => openDemo(company, "admin", false)}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700"
                                >
                                    <PencilLine size={16} />
                                    İşlem Modu
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setImpersonationModal({ isOpen: true, companyId: company.id, companyName: company.name })}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-xs font-black text-white hover:bg-amber-700"
                                >
                                    <LogIn size={16} />
                                    Firma Olarak Giriş
                                </button>
                            </div>
                        </div>
                        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                            <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Firma Modülleri</div>
                            <div className="flex flex-wrap gap-2">
                                {editableModules.map((module) => {
                                    const active = company.enabled_modules.includes(module);
                                    return (
                                        <button
                                            key={module}
                                            type="button"
                                            disabled={savingId === company.id}
                                            onClick={() => toggleModule(company, module)}
                                            className={cn(
                                                "rounded-xl border px-3 py-2 text-xs font-black transition",
                                                active
                                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200"
                                                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400",
                                            )}
                                        >
                                            {moduleLabels[module] || module}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        {expandedCompanyId === company.id && (
                            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Cihaz Yonetimi</div>
                                        <div className="mt-1 text-sm text-slate-500">
                                            Aktif cihaz: {company.active_device_count} / Lisans limiti: {company.max_devices}
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <input
                                            type="number"
                                            min={1}
                                            value={deviceLimitInputs[company.id] ?? String(company.max_devices)}
                                            onChange={(e) => setDeviceLimitInputs((prev) => ({ ...prev, [company.id]: e.target.value }))}
                                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-800 sm:w-28"
                                        />
                                        <button
                                            type="button"
                                            disabled={savingId === company.id}
                                            onClick={() => updateDeviceLimit(company)}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60"
                                        >
                                            <Plus size={16} />
                                            Limiti Kaydet
                                        </button>
                                    </div>
                                </div>

                                {(requestsByCompany[company.id] ?? []).length > 0 && (
                                    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                                        <div className="mb-3 text-xs font-black uppercase tracking-wide text-amber-700 dark:text-amber-200">Bekleyen Cihaz Talepleri</div>
                                        <div className="space-y-2">
                                            {(requestsByCompany[company.id] ?? []).map((request) => (
                                                <div key={request.id} className="flex flex-col gap-3 rounded-xl bg-white p-3 text-sm dark:bg-slate-900 lg:flex-row lg:items-center lg:justify-between">
                                                    <div className="min-w-0">
                                                        <div className="font-black text-slate-900 dark:text-white">{request.title || "Cihaz limiti talebi"}</div>
                                                        <div className="mt-1 text-xs text-slate-500">
                                                            {request.profile?.full_name || "Kullanici"} - {format(new Date(request.created_at), "dd MMM yyyy HH:mm", { locale: tr })}
                                                        </div>
                                                        <div className="mt-1 truncate text-xs text-slate-400">
                                                            {request.support_metadata?.device_name || request.support_metadata?.requested_device_id || "Yeni cihaz"}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col gap-2 sm:flex-row">
                                                        <button
                                                            type="button"
                                                            disabled={savingId === company.id}
                                                            onClick={() => approveDeviceRequest(company.id, request.id, "increase_limit")}
                                                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                                                        >
                                                            <CheckCircle2 size={16} />
                                                            Limit Artir
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={savingId === company.id}
                                                            onClick={() => approveDeviceRequest(company.id, request.id, "remove_device")}
                                                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-60"
                                                        >
                                                            <Trash2 size={16} />
                                                            Eskiyi Kaldir
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                                    <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                                        <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500 dark:bg-slate-950/60">
                                            <tr>
                                                <th className="px-4 py-3">Cihaz</th>
                                                <th className="px-4 py-3">Tarayici / OS</th>
                                                <th className="px-4 py-3">Son Giris</th>
                                                <th className="px-4 py-3">IP</th>
                                                <th className="px-4 py-3">Durum</th>
                                                <th className="px-4 py-3 text-right">Islem</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                                            {(devicesByCompany[company.id] ?? []).map((device) => (
                                                <tr key={device.id}>
                                                    <td className="px-4 py-3">
                                                        <div className="font-bold text-slate-900 dark:text-white">{device.device_name || "Adsiz cihaz"}</div>
                                                        <div className="max-w-[220px] truncate text-xs text-slate-400">{device.device_id}</div>
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                                        <div>{device.browser_name || "Bilinmiyor"}</div>
                                                        <div className="text-xs text-slate-400">{device.os_name || device.user_agent || "-"}</div>
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                                        {device.last_seen_at ? format(new Date(device.last_seen_at), "dd MMM yyyy HH:mm", { locale: tr }) : "-"}
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{device.ip_address || "-"}</td>
                                                    <td className="px-4 py-3">
                                                        <span className={cn(
                                                            "rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest",
                                                            device.is_active === false ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-700",
                                                        )}>
                                                            {device.is_active === false ? "Pasif" : "Aktif"}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex justify-end gap-2">
                                                            <button
                                                                type="button"
                                                                title={device.is_active === false ? "Aktife al" : "Pasife al"}
                                                                disabled={savingId === company.id}
                                                                onClick={() => setDeviceActive(company.id, device.id, device.is_active === false)}
                                                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                                                            >
                                                                <Power size={16} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                title="Cihazi sil"
                                                                disabled={savingId === company.id}
                                                                onClick={() => deleteDevice(company.id, device.id)}
                                                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/60"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                            {(devicesByCompany[company.id] ?? []).length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">
                                                        Bu firmada kayitli cihaz yok.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Impersonation Modal */}
            <ImpersonationModal
                isOpen={impersonationModal.isOpen}
                onClose={() => setImpersonationModal({ ...impersonationModal, isOpen: false })}
                companyId={impersonationModal.companyId}
                companyName={impersonationModal.companyName}
            />
        </div>
    );
}
