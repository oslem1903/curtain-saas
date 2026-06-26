import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Eye, PencilLine, Search, Users } from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";

import { setDemoTenantContext, supabase } from "../supabaseClient";
import { cn } from "../utils/cn";
import { CORE_MODULES, ENTERPRISE_MODULES, PRO_MODULES, SOLO_MODULES } from "../context/AuthContext";

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

export default function SuperAdminCompanies() {
    const nav = useNavigate();
    const [companies, setCompanies] = useState<CompanyStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [savingId, setSavingId] = useState<string | null>(null);

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
        });
    }

    async function toggleModule(company: CompanyStats, module: string) {
        const current = new Set(company.enabled_modules || []);
        if (current.has(module)) current.delete(module);
        else current.add(module);
        await updateCompany(company.id, { enabled_modules: Array.from(current) });
    }

    function openDemo(company: CompanyStats, role: "admin" | "accountant" | "installer", readOnly = true) {
        setDemoTenantContext(company.id, readOnly);
        localStorage.setItem("demo_viewing_role", role);
        localStorage.removeItem("demo_viewing_user_id");
        const target = role === "accountant" ? "/accounting" : role === "installer" ? "/route/today" : "/dashboard";
        nav(target);
        window.setTimeout(() => window.location.reload(), 50);
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
                    </div>
                ))}
            </div>
        </div>
    );
}
