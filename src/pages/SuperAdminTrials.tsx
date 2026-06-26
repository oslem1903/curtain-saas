import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Calculator, Clock, Copy, KeyRound, Loader2, Mail, RefreshCw, ShieldCheck, UserCog, UserPlus, Wrench } from "lucide-react";
import { supabase } from "../supabaseClient";
import { useRole } from "../context/RoleContext";
import { CORE_MODULES, ENTERPRISE_MODULES, PRO_MODULES, SOLO_MODULES } from "../context/AuthContext";
import { type RoleState } from "../auth/roles";

type CompanyInviteResult = {
    company_id: string;
    invite_id: string;
    token: string;
    invite_code?: string;
    expires_at: string;
    trial_end: string;
    trial_ends_at?: string;
};

type CompanyRow = {
    id: string;
    name: string | null;
    owner_id: string | null;
    subscription_plan: string | null;
    package_code?: string | null;
    enabled_modules?: string[] | null;
    trial_ends_at: string | null;
    created_at?: string | null;
};

type ProfileRow = {
    user_id: string;
    email: string | null;
    full_name: string | null;
    role: string | null;
};

type InviteRow = {
    id: string;
    company_id: string;
    email: string | null;
    role: string | null;
    invite_code: string | null;
    expires_at: string | null;
    used_at: string | null;
    created_at: string | null;
};

type CustomerAccount = CompanyRow & {
    ownerEmail: string;
    ownerName: string;
    ownerRole: string;
    package_code: string | null;
    enabled_modules: string[];
    pendingInvites: InviteRow[];
};

const planLabels: Record<string, string> = {
    starter: "Başlangıç",
    solo: "Solo Perdeci",
    pro: "Profesyonel",
    enterprise: "Kurumsal",
    lifetime: "Ömür Boyu",
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

const editableModules = [
    "admin",
    "measurements",
    "orders",
    "suppliers",
    "installation",
    "accounting",
    "staff",
    "vehicles",
    "commissions",
    "warehouse",
    "catalogs",
    "reports",
    "expenses",
    "profit",
    "customers",
    "appointments",
    "branches",
];

function modulesForPlan(plan: string) {
    if (plan === "solo") return SOLO_MODULES;
    if (plan === "pro") return PRO_MODULES;
    if (plan === "enterprise" || plan === "lifetime") return ENTERPRISE_MODULES;
    return CORE_MODULES;
}

function formatDateTR(iso?: string | null) {
    if (!iso) return "-";
    return new Date(iso).toLocaleString("tr-TR");
}

function trialState(row: CompanyRow) {
    if (row.subscription_plan === "lifetime") return { label: "Lisanslı", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    const end = row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : 0;
    if (end > 0 && Date.now() > end) return { label: "Süresi doldu", className: "bg-red-50 text-red-700 border-red-200" };
    return { label: "Deneme", className: "bg-indigo-50 text-indigo-700 border-indigo-200" };
}

function daysLeft(iso?: string | null) {
    if (!iso) return "-";
    const diff = new Date(iso).getTime() - Date.now();
    return String(Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000))));
}

export default function SuperAdminTrials() {
    const { realRole, viewingRole, setViewingRoleAndUser, clearSimulation, isSimulating } = useRole();
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [days, setDays] = useState(7);
    const [companyName, setCompanyName] = useState("PerdePRO");
    const [newCompanyPackage, setNewCompanyPackage] = useState("solo");
    const [isPilot, setIsPilot] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadingList, setLoadingList] = useState(false);
    const [err, setErr] = useState("");
    const [listErr, setListErr] = useState("");
    const [result, setResult] = useState<CompanyInviteResult | null>(null);
    const [accounts, setAccounts] = useState<CustomerAccount[]>([]);
    const [extensionDays, setExtensionDays] = useState<Record<string, number>>({});
    const [extendingId, setExtendingId] = useState<string | null>(null);
    const [modulePanelId, setModulePanelId] = useState<string | null>(null);
    const [moduleSavingId, setModuleSavingId] = useState<string | null>(null);

    const canSubmit = useMemo(() => {
        return email.trim().includes("@") && companyName.trim().length >= 2 && days > 0 && days <= 365;
    }, [companyName, days, email]);

    function generateTestEmail() {
        const stamp = new Date().toISOString().replace(/\D/g, "").slice(4, 14);
        setEmail(`test${stamp}@gmail.com`);
    }

    async function loadAccounts() {
        setLoadingList(true);
        setListErr("");

        try {
            let { data: companies, error: companyErr }: { data: any[] | null; error: any } = await supabase
                .from("companies")
                .select("id,name,owner_id,subscription_plan,package_code,enabled_modules,trial_ends_at,created_at")
                .order("created_at", { ascending: false });

            if (companyErr && /(package_code|enabled_modules|schema cache)/i.test(companyErr.message || "")) {
                const legacy = await supabase
                    .from("companies")
                    .select("id,name,owner_id,subscription_plan,trial_ends_at,created_at")
                    .order("created_at", { ascending: false });
                companies = legacy.data;
                companyErr = legacy.error;
            }

            if (companyErr) throw companyErr;

            const rows = (companies ?? []) as CompanyRow[];
            const companyIds = rows.map((row) => row.id).filter(Boolean);
            const ownerIds = rows.map((row) => row.owner_id).filter(Boolean) as string[];

            let profiles: ProfileRow[] = [];
            if (ownerIds.length > 0) {
                const { data: profileData, error: profileErr } = await supabase
                    .from("profiles")
                    .select("user_id,email,full_name,role")
                    .in("user_id", ownerIds);

                if (profileErr) throw profileErr;
                profiles = (profileData ?? []) as ProfileRow[];
            }

            const inviteMap = new Map<string, InviteRow[]>();
            if (companyIds.length > 0) {
                const { data: inviteData, error: inviteErr } = await supabase
                    .from("user_invites")
                    .select("id,company_id,email,role,invite_code,expires_at,used_at,created_at")
                    .in("company_id", companyIds)
                    .is("used_at", null)
                    .order("created_at", { ascending: false });

                if (inviteErr && !/(invite_code|schema cache)/i.test(inviteErr.message || "")) throw inviteErr;

                ((inviteData ?? []) as InviteRow[]).forEach((invite) => {
                    const existing = inviteMap.get(invite.company_id) ?? [];
                    inviteMap.set(invite.company_id, [...existing, invite]);
                });
            }

            const profileMap = new Map(profiles.map((profile) => [profile.user_id, profile]));
            setAccounts(
                rows.map((row) => {
                    const owner = row.owner_id ? profileMap.get(row.owner_id) : undefined;
                    return {
                        ...row,
                        ownerEmail: owner?.email || "-",
                        ownerName: owner?.full_name || "-",
                        ownerRole: owner?.role || "-",
                        package_code: row.package_code || (row.subscription_plan === "starter" ? "solo" : row.subscription_plan),
                        enabled_modules: Array.isArray(row.enabled_modules) ? row.enabled_modules : modulesForPlan(row.package_code || row.subscription_plan || "starter"),
                        pendingInvites: inviteMap.get(row.id) ?? [],
                    };
                })
            );
        } catch (e: any) {
            setAccounts([]);
            setListErr(e?.message ?? "Kullanıcı listesi yüklenemedi.");
        } finally {
            setLoadingList(false);
        }
    }

    async function updateCompanyModules(companyId: string, patch: Record<string, unknown>) {
        setModuleSavingId(companyId);
        setListErr("");
        try {
            const { error } = await supabase.from("companies").update(patch).eq("id", companyId);
            if (error) throw error;
            await loadAccounts();
        } catch (e: any) {
            const message = String(e?.message ?? "");
            if (/(enabled_modules|package_code|schema cache)/i.test(message)) {
                setListErr("Modül alanları Supabase'te yok görünüyor. Önce supabase_modular_saas_upgrade.sql migration dosyasını SQL Editor'da çalıştırın.");
            } else {
                setListErr(message || "Modül tanımı güncellenemedi.");
            }
        } finally {
            setModuleSavingId(null);
        }
    }

    async function applyPackage(account: CustomerAccount, plan: string) {
        await updateCompanyModules(account.id, {
            subscription_plan: plan === "solo" ? "starter" : plan,
            package_code: plan,
            enabled_modules: modulesForPlan(plan),
        });
    }

    async function toggleModule(account: CustomerAccount, module: string) {
        const current = new Set(account.enabled_modules || []);
        if (current.has(module)) current.delete(module);
        else current.add(module);
        await updateCompanyModules(account.id, { enabled_modules: Array.from(current) });
    }

    useEffect(() => {
        loadAccounts();
    }, []);

    async function handleCreateTrial() {
        setErr("");
        setResult(null);

        if (!canSubmit) {
            setErr("E-posta, en az 6 karakter şifre ve geçerli gün sayısı girin.");
            return;
        }

        try {
            setSaving(true);

            const { data, error } = await supabase.rpc("create_company_with_owner_invite", {
                p_company_name: companyName.trim() || "PerdePRO",
                p_owner_email: email.trim().toLowerCase(),
                p_trial_days: days,
                p_is_pilot: isPilot,
            });

            if (error) throw error;

            const inviteResult = (Array.isArray(data) ? data[0] : data) as CompanyInviteResult;
            if (inviteResult.company_id) {
                await supabase
                    .from("companies")
                    .update({
                        subscription_plan: newCompanyPackage === "solo" ? "starter" : newCompanyPackage,
                        package_code: newCompanyPackage,
                        enabled_modules: modulesForPlan(newCompanyPackage),
                    })
                    .eq("id", inviteResult.company_id);
            }
            setResult({ ...inviteResult, trial_ends_at: inviteResult.trial_end });
            await loadAccounts();
        } catch (e: any) {
            const message = String(e?.message ?? "");
            if (message.includes("create_company_with_owner_invite") || message.includes("schema cache")) {
                setErr("Supabase kurulum fonksiyonu güncel değil. Önce supabase_fix_provision_trial_rpc.sql, sonra supabase_invite_code_flow.sql dosyasını SQL Editor'da çalıştırın.");
            } else {
                setErr(message || "Deneme kullanıcısı oluşturulamadı.");
            }
        } finally {
            setSaving(false);
        }
    }

    async function copyInviteCode() {
        if (!result?.invite_code) return;
        try {
            await navigator.clipboard.writeText(result.invite_code);
        } catch {
            setErr("Davet kodu kopyalanamadi. Kodu elle secip kopyalayabilirsiniz.");
        }
    }

    async function copyPendingInviteCode(code: string | null) {
        if (!code) {
            setListErr("Bu davette kod görünmüyor. Supabase SQL Editor'da supabase_invite_code_flow.sql dosyasını çalıştırın.");
            return;
        }

        try {
            await navigator.clipboard.writeText(code);
        } catch {
            setListErr("Davet kodu kopyalanamadı. Kodu elle seçip kopyalayabilirsiniz.");
        }
    }

    async function handleExtendTrial(companyId: string) {
        const extraDays = extensionDays[companyId] || 7;
        if (extraDays < 1 || extraDays > 365) {
            setListErr("Uzatma süresi 1 ile 365 gün arasında olmalı.");
            return;
        }

        setListErr("");
        setExtendingId(companyId);

        try {
            const { error } = await supabase.rpc("extend_company_trial", {
                p_company_id: companyId,
                p_extra_days: extraDays,
            });

            if (error) throw error;
            await loadAccounts();
        } catch (e: any) {
            const message = String(e?.message ?? "");
            if (message.includes("extend_company_trial") || message.includes("schema cache")) {
                setListErr("Süre uzatma fonksiyonu Supabase'te kurulu değil. Güncel supabase_fix_provision_trial_rpc.sql dosyasını SQL Editor'da çalıştırın.");
            } else {
                setListErr(message || "Süre uzatılamadı.");
            }
        } finally {
            setExtendingId(null);
        }
    }

    function switchDemoRole(role: RoleState) {
        setViewingRoleAndUser(role, null);
        if (role === "accountant") navigate("/accounting");
        else if (role === "installer" || role === "measurement") navigate("/route/today");
        else navigate("/dashboard");
    }

    const roleCards = [
        {
            role: "admin" as RoleState,
            title: "Yönetici",
            description: "Sipariş, müşteri, finans, ürün ve personel yönetimini görür.",
            icon: UserCog,
        },
        {
            role: "accountant" as RoleState,
            title: "Muhasebe",
            description: "Finans, tedarikçiler, faturalar ve raporlar alanında çalışır.",
            icon: Calculator,
        },
        {
            role: "installer" as RoleState,
            title: "Montaj",
            description: "Bugünün rotası, siparişler, müşteriler ve kartela ekranını görür.",
            icon: Wrench,
        },
    ];
    const showRolePreviewPanel = import.meta.env.VITE_SHOW_ROLE_PREVIEW_PANEL === "true";

    return (
        <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
                        <ShieldCheck className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Süper Yönetici</h1>
                        <p className="text-sm text-slate-500">Müşteri hesaplarını, deneme sürelerini ve yeni kurulumları yönetin.</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={loadAccounts}
                    disabled={loadingList}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                >
                    <RefreshCw className={`w-4 h-4 ${loadingList ? "animate-spin" : ""}`} />
                    Listeyi Yenile
                </button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {showRolePreviewPanel && realRole === "super_admin" ? (
                    <div className="xl:col-span-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                    <ShieldCheck className="h-4 w-4" />
                                    Yetkiler / Rol Değiştir
                                </div>
                                <h2 className="mt-3 text-xl font-black text-slate-900 dark:text-white">Müşteriye rol bazlı ekranı göster</h2>
                                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    Süper admin olarak programı tanıtırken Yönetici, Muhasebe veya Montaj rolünü seçin; uygulama o role ait sade menü ve ekranlara geçer.
                                </p>
                            </div>
                            {isSimulating ? (
                                <button
                                    type="button"
                                    onClick={clearSimulation}
                                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white"
                                >
                                    Süper Admin Görünümüne Dön
                                </button>
                            ) : null}
                        </div>
                        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                            {roleCards.map((item) => (
                                <button
                                    key={item.role}
                                    type="button"
                                    onClick={() => switchDemoRole(item.role)}
                                    className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                                        viewingRole === item.role
                                            ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                                            : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-800 shadow-sm">
                                            <item.icon className="h-5 w-5" />
                                        </div>
                                        <div className="font-black">{item.title}</div>
                                    </div>
                                    <p className="mt-3 text-sm leading-6 opacity-80">{item.description}</p>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}
                <div className="xl:col-span-1 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-5">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold">
                        <UserPlus className="w-5 h-5 text-indigo-600" />
                        Yeni Deneme Hesabı
                    </div>

                    {err ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                            {err}
                        </div>
                    ) : null}

                    <div className="space-y-4">
                        <label className="block">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">E-posta</span>
                                <button
                                    type="button"
                                    onClick={generateTestEmail}
                                    className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-black text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                                >
                                    Test e-postası üret
                                </button>
                            </div>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="müşteri@gmail.com"
                                className="mt-1 w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3"
                            />
                        </label>

                        <label className="block">
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Giriş Kodu</span>
                            <div className="mt-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                                Sistem kod üretir. Kullanıcı e-posta + kod ile girip kendi şifresini belirler.
                            </div>
                        </label>

                        <label className="block">
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Deneme Süresi</span>
                            <div className="mt-1 flex items-center gap-2">
                                <input
                                    type="number"
                                    min={1}
                                    max={365}
                                    value={days}
                                    onChange={(e) => setDays(Number(e.target.value))}
                                    className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3"
                                />
                                <span className="font-bold text-slate-500">gün</span>
                            </div>
                        </label>

                        <label className="block">
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Şirket/Uygulama Adı</span>
                            <input
                                value={companyName}
                                onChange={(e) => setCompanyName(e.target.value)}
                                placeholder="PerdePRO"
                                className="mt-1 w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3"
                            />
                        </label>

                        <label className="block">
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Paket</span>
                            <select
                                value={newCompanyPackage}
                                onChange={(e) => setNewCompanyPackage(e.target.value)}
                                className="mt-1 w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-3"
                            >
                                <option value="starter">Başlangıç</option>
                                <option value="solo">Solo Perdeci</option>
                                <option value="pro">Profesyonel</option>
                                <option value="enterprise">Kurumsal</option>
                                <option value="lifetime">Tüm Modüller</option>
                            </select>
                        </label>

                        <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                            <span>Pilot müşteri olarak işaretle</span>
                            <input
                                type="checkbox"
                                checked={isPilot}
                                onChange={(e) => setIsPilot(e.target.checked)}
                                className="h-5 w-5 rounded border-slate-300 text-indigo-600"
                            />
                        </label>
                    </div>

                    <button
                        type="button"
                        onClick={handleCreateTrial}
                        disabled={saving || !canSubmit}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 font-black text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
                        Deneme Kullanıcısı Oluştur
                    </button>

                    <div className="rounded-3xl bg-slate-900 text-white p-5 space-y-3">
                        <div className="text-xs tracking-wider text-slate-400 font-bold">Kullanıcıya Verilecek</div>
                        <div className="flex items-start gap-3">
                            <Mail className="w-4 h-4 mt-1 text-slate-400" />
                            <div className="min-w-0">
                                <div className="text-xs text-slate-400">E-posta</div>
                                <div className="font-bold break-words">{email || "-"}</div>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <KeyRound className="w-4 h-4 mt-1 text-slate-400" />
                            <div className="min-w-0">
                                <div className="text-xs text-slate-400">Kod</div>
                                <div className="font-bold break-words">{result?.invite_code || "Hesap oluşturunca üretilecek"}</div>
                            </div>
                        </div>
                        {result ? (
                            <div className="rounded-2xl bg-emerald-500/15 border border-emerald-400/30 p-4 text-sm">
                                <div className="font-black text-emerald-300">Hesap hazır</div>
                                <div className="mt-1 text-slate-200">Bitiş: {formatDateTR(result.trial_ends_at)}</div>
                                <div className="mt-3 rounded-xl bg-black/20 p-4 text-center font-mono text-2xl font-black tracking-widest text-slate-100">{result.invite_code || "SQL GÜNCELLE"}</div>
                                <div className="mt-2 text-xs text-slate-300">Kullanıcı giriş ekranında e-posta ve bu kodu yazıp kendi şifresini belirler.</div>
                                <button
                                    type="button"
                                    onClick={copyInviteCode}
                                    disabled={!result.invite_code}
                                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/15"
                                >
                                    <Copy className="h-4 w-4" />
                                    Kodu Kopyala
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="xl:col-span-2 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-black text-slate-900 dark:text-white">Müşteri / Kullanıcı Listesi</h2>
                            <p className="text-sm text-slate-500">{accounts.length} kayıt</p>
                        </div>
                    </div>

                    {listErr ? (
                        <div className="m-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                            {listErr}
                        </div>
                    ) : null}

                    {loadingList ? (
                        <div className="p-8 flex items-center gap-3 text-slate-500 font-semibold">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Liste yükleniyor...
                        </div>
                    ) : accounts.length === 0 ? (
                        <div className="p-8 text-slate-500">Henüz müşteri hesabı bulunamadı.</div>
                    ) : (
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {accounts.map((account) => {
                                const state = trialState(account);
                                return (
                                    <div key={account.id} className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <Building2 className="w-5 h-5 text-indigo-600 shrink-0" />
                                                 <div className="font-black text-slate-900 dark:text-white truncate">{account.name || "İsimsiz şirket"}</div>
                                            </div>
                                            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-500">
                                                <div>E-posta: <span className="font-semibold text-slate-700 dark:text-slate-200">{account.ownerEmail}</span></div>
                                                <div>Rol: <span className="font-semibold text-slate-700 dark:text-slate-200">{account.ownerRole}</span></div>
                                                <div>Paket: <span className="font-semibold text-slate-700 dark:text-slate-200">{planLabels[account.package_code || account.subscription_plan || "starter"] || account.package_code || account.subscription_plan || "starter"}</span></div>
                                                <div>Modül: <span className="font-semibold text-slate-700 dark:text-slate-200">{account.enabled_modules.length}</span></div>
                                                <div className="sm:col-span-2">Bitiş: <span className="font-semibold text-slate-700 dark:text-slate-200">{formatDateTR(account.trial_ends_at)}</span></div>
                                            </div>
                                        </div>

                                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
                                            <div className="flex items-center gap-3">
                                                <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">
                                                    <Clock className="w-4 h-4 text-slate-400" />
                                                    {daysLeft(account.trial_ends_at)} gün
                                                </div>
                                                <div className={`rounded-2xl border px-3 py-2 text-sm font-black ${state.className}`}>
                                                    {state.label}
                                                </div>
                                            </div>

                                            {account.subscription_plan !== "lifetime" ? (
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        max={365}
                                                        value={extensionDays[account.id] ?? 7}
                                                        onChange={(e) =>
                                                            setExtensionDays((prev) => ({
                                                                ...prev,
                                                                [account.id]: Number(e.target.value),
                                                            }))
                                                        }
                                                        className="w-20 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                                                        aria-label={`${account.name || "Şirket"} uzatma günü`}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleExtendTrial(account.id)}
                                                        disabled={extendingId === account.id}
                                                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-black text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
                                                    >
                                                        {extendingId === account.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                                        Gün Ekle
                                                    </button>
                                                </div>
                                            ) : null}
                                            <button
                                                type="button"
                                                onClick={() => setModulePanelId((prev) => (prev === account.id ? null : account.id))}
                                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-black text-indigo-700 hover:bg-indigo-100"
                                            >
                                                Modül Tanımla
                                            </button>
                                        </div>
                                        {modulePanelId === account.id ? (
                                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 lg:col-span-2">
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                    <div>
                                                        <div className="text-sm font-black text-slate-900 dark:text-white">Firma Modülleri</div>
                                                        <div className="text-xs text-slate-500">Paket seç veya tek tek modül aç/kapat.</div>
                                                    </div>
                                                    <select
                                                        value={account.package_code || account.subscription_plan || "starter"}
                                                        disabled={moduleSavingId === account.id}
                                                        onChange={(e) => applyPackage(account, e.target.value)}
                                                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold dark:border-slate-700 dark:bg-slate-900"
                                                    >
                                                        <option value="starter">Başlangıç</option>
                                                        <option value="solo">Solo Perdeci</option>
                                                        <option value="pro">Profesyonel</option>
                                                        <option value="enterprise">Kurumsal</option>
                                                        <option value="lifetime">Tüm Modüller</option>
                                                    </select>
                                                </div>
                                                <div className="mt-4 flex flex-wrap gap-2">
                                                    {editableModules.map((module) => {
                                                        const active = account.enabled_modules.includes(module);
                                                        return (
                                                            <button
                                                                key={module}
                                                                type="button"
                                                                disabled={moduleSavingId === account.id}
                                                                onClick={() => toggleModule(account, module)}
                                                                className={`rounded-xl border px-3 py-2 text-xs font-black transition ${
                                                                    active
                                                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200"
                                                                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
                                                                }`}
                                                            >
                                                                {moduleLabels[module] || module}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                {moduleSavingId === account.id ? <div className="mt-3 text-xs font-bold text-indigo-600">Kaydediliyor...</div> : null}
                                            </div>
                                        ) : null}
                                        {account.pendingInvites.length > 0 ? (
                                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/10 lg:col-span-2">
                                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                                    <div>
                                                        <div className="text-sm font-black text-amber-950 dark:text-amber-100">Açık davet kodları</div>
                                                        <div className="text-xs font-semibold text-amber-700 dark:text-amber-200">
                                                            Kullanıcı kodu kaybederse buradan tekrar kopyalayabilirsiniz.
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="mt-3 grid grid-cols-1 gap-2">
                                                    {account.pendingInvites.map((invite) => (
                                                        <div key={invite.id} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-3 text-sm dark:border-amber-900/50 dark:bg-slate-950 sm:flex-row sm:items-center sm:justify-between">
                                                            <div className="min-w-0">
                                                                <div className="font-black text-slate-900 dark:text-white">{invite.email || "-"}</div>
                                                                <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                                                                    <span>Rol: {invite.role || "-"}</span>
                                                                    <span>Bitiş: {formatDateTR(invite.expires_at)}</span>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <div className="rounded-xl bg-slate-900 px-3 py-2 font-mono text-sm font-black tracking-widest text-white">
                                                                    {invite.invite_code || "KOD YOK"}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => copyPendingInviteCode(invite.invite_code)}
                                                                    className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-xs font-black text-white hover:bg-amber-700"
                                                                >
                                                                    <Copy className="h-4 w-4" />
                                                                    Kopyala
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
