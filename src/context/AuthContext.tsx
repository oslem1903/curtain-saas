/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, setAppReadOnlyMode } from "../supabaseClient";
import { normalizeRole, type RoleState } from "../auth/roles";

type CompanyState = {
    id: string;
    name: string | null;
    is_active: boolean | null;
    read_only: boolean | null;
    plan_status: string | null;
    subscription_plan: string | null;
    max_users: number | null;
    enabled_modules: string[] | null;
    package_code?: string | null;
    branch_limit: number | null;
    trial_end: string | null;
    trial_ends_at: string | null;
    is_pilot: boolean | null;
};

export const CORE_MODULES = ["admin", "measurements", "orders", "customers", "appointments", "catalogs", "staff"];
// Solo Perdeci: kartela (catalogs) ve personel (staff) modülleri pakete dahil DEĞİL
export const SOLO_MODULES = ["admin", "measurements", "orders", "customers", "appointments", "suppliers", "installation"];
export const PRO_MODULES = [...SOLO_MODULES, "accounting", "staff", "catalogs", "reports", "expenses", "profit"];
export const ENTERPRISE_MODULES = [...PRO_MODULES, "vehicles", "commissions", "warehouse", "branches"];

const MODULE_ALIASES: Record<string, string[]> = {
    admin: ["admin", "manager"],
    measurements: ["measurements", "measure", "appointments"],
    orders: ["orders"],
    suppliers: ["suppliers"],
    installation: ["installation", "montaj"],
    accounting: ["accounting"],
    staff: ["staff", "personnel"],
    vehicles: ["vehicles"],
    commissions: ["commissions"],
    warehouse: ["warehouse"],
    catalogs: ["catalogs", "products", "urunler", "ürünler"],
    reports: ["reports"],
    expenses: ["expenses"],
    profit: ["profit"],
    customers: ["customers"],
    appointments: ["appointments"],
    branches: ["branches"],
};

function normalizeEnabledModules(modules: string[]) {
    const normalized = new Set<string>();
    modules.forEach((item) => {
        const value = String(item || "").trim();
        if (!value) return;
        normalized.add(value);
        Object.entries(MODULE_ALIASES).forEach(([canonical, aliases]) => {
            if (aliases.includes(value)) normalized.add(canonical);
        });
    });
    return Array.from(normalized);
}

type AuthStatus = "loading" | "unauthenticated" | "ready" | "unauthorized" | "locked";
type LockReason = "inactive_user" | "inactive_member" | "inactive_company" | "expired_trial" | "read_only" | "device_limit" | "unknown";

export function getDeviceId() {
    const key = "curtain_saas_device_id";
    let id = localStorage.getItem(key);
    if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(key, id);
    }
    return id;
}

type AuthContextValue = {
    status: AuthStatus;
    user: User | null;
    role: RoleState;
    companyId: string | null;
    company: CompanyState | null;
    memberRole: RoleState;
    readOnly: boolean;
    enabledModules: string[];
    hasModule: (module: string) => boolean;
    lockReason: LockReason | null;
    refreshAuth: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function withTimeout<T>(promise: PromiseLike<T>, label: string, ms = 6000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(`${label} zaman asimina ugradi.`)), ms);
        promise.then(
            (value) => {
                window.clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                window.clearTimeout(timer);
                reject(error);
            },
        );
    });
}

function isTrialExpired(company: CompanyState) {
    if (company.is_pilot) return false;
    const status = String(company.plan_status ?? "").toLowerCase();
    if (status === "expired") return true;
    if (status === "active" || status === "lifetime") return false;

    const rawEnd = company.trial_end || company.trial_ends_at;
    if (!rawEnd) return false;
    return new Date(rawEnd).getTime() < Date.now();
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<AuthStatus>("loading");
    const [user, setUser] = useState<User | null>(null);
    const [role, setRole] = useState<RoleState>("unknown");
    const [memberRole, setMemberRole] = useState<RoleState>("unknown");
    const [company, setCompany] = useState<CompanyState | null>(null);
    const [lockReason, setLockReason] = useState<LockReason | null>(null);
    // İlk yükleme tamamlandı mı? Arka plan refresh'lerinde loading ekranı gösterme.
    const hasLoadedOnce = useRef(false);

    const loadAuth = async () => {
        const isFirstLoad = !hasLoadedOnce.current;
        try {
            if (isFirstLoad) {
                setStatus("loading");
                setLockReason(null);
            }

            const { data: sessionData } = await withTimeout(supabase.auth.getSession(), "Oturum kontrolu");
            const sessionUser = sessionData.session?.user ?? null;

            setUser(sessionUser);
            if (isFirstLoad) {
                setCompany(null);
                setRole("unknown");
                setMemberRole("unknown");
            }

            if (!sessionUser) {
                hasLoadedOnce.current = false;
                setStatus("unauthenticated");
                return;
            }

            const { data: rpcProfile, error: rpcProfileError } = await withTimeout(
                supabase.rpc("get_current_auth_context"),
                "Yetki kontrolu",
            );

        let profile = Array.isArray(rpcProfile) ? rpcProfile[0] : rpcProfile;
        let profileError = rpcProfileError;

        if (!profile?.role) {
            const byUserId = await withTimeout(
                supabase
                    .from("profiles")
                    .select("role,is_active")
                    .eq("user_id", sessionUser.id)
                    .maybeSingle(),
                "Profil kontrolu",
            );

            if (byUserId.data?.role) {
                profile = byUserId.data;
                profileError = byUserId.error;
            }
        }

        if (!profile?.role && sessionUser.email) {
            const byEmail = await withTimeout(
                supabase
                    .from("profiles")
                    .select("role,is_active")
                    .ilike("email", sessionUser.email)
                    .maybeSingle(),
                "Profil e-posta kontrolu",
            );

            if (byEmail.data?.role) {
                profile = byEmail.data;
                profileError = byEmail.error;
            }
        }

        if (rpcProfileError && !profile?.role) {
            profileError = rpcProfileError;
        }

        if (profileError || !profile) {
            hasLoadedOnce.current = false;
            setStatus("unauthorized");
            return;
        }

        if (profile.is_active === false) {
            setLockReason("inactive_user");
            hasLoadedOnce.current = true;
            setStatus("locked");
            return;
        }

        const profileRole = normalizeRole(profile.role);
        setRole(profileRole);
        setMemberRole(profileRole);

        if (profileRole === "super_admin") {
            const demoCompanyId = localStorage.getItem("demo_company_id");
            if (demoCompanyId) {
                const { data: demoCompany } = await withTimeout(
                    supabase
                        .from("companies")
                        .select("id,name,is_active,read_only,plan_status,subscription_plan,max_users,enabled_modules,package_code,branch_limit,trial_end,trial_ends_at,is_pilot")
                        .eq("id", demoCompanyId)
                        .maybeSingle(),
                    "Demo firma kontrolu",
                );

                if (demoCompany?.id) {
                    setCompany(demoCompany as CompanyState);
                    setAppReadOnlyMode(localStorage.getItem("demo_read_only") !== "false");
                } else {
                    localStorage.removeItem("demo_company_id");
                    localStorage.removeItem("demo_read_only");
                    setAppReadOnlyMode(false);
                }
            } else {
                setAppReadOnlyMode(false);
            }
            setStatus("ready");
            return;
        }

            const { data: member, error: memberError } = await withTimeout(
                supabase
                    .from("company_members")
                    .select("company_id,role,is_active,companies(id,name,is_active,read_only,plan_status,subscription_plan,max_users,enabled_modules,package_code,branch_limit,trial_end,trial_ends_at,is_pilot)")
                    .eq("user_id", sessionUser.id)
                    .order("created_at", { ascending: true })
                    .limit(1)
                    .maybeSingle(),
                "Firma uyeligi kontrolu",
            );

        if (memberError || !member?.company_id) {
            hasLoadedOnce.current = false;
            setStatus("unauthorized");
            return;
        }

        if (member.is_active === false) {
            setLockReason("inactive_member");
            hasLoadedOnce.current = true;
            setStatus("locked");
            return;
        }

        const rowCompany = Array.isArray(member.companies) ? member.companies[0] : member.companies;
        const activeCompany = rowCompany as CompanyState | null;

        if (!activeCompany?.id) {
            hasLoadedOnce.current = false;
            setStatus("unauthorized");
            return;
        }

        setCompany(activeCompany);
        setAppReadOnlyMode(Boolean(activeCompany.read_only) || isTrialExpired(activeCompany));
        setMemberRole(normalizeRole(member.role) === "unknown" ? profileRole : normalizeRole(member.role));

        if (activeCompany.is_active === false || String(activeCompany.plan_status ?? "").toLowerCase() === "suspended") {
            setLockReason("inactive_company");
            hasLoadedOnce.current = true;
            setStatus("locked");
            return;
        }

        if (isTrialExpired(activeCompany)) {
            setLockReason(activeCompany.read_only ? "read_only" : "expired_trial");
            hasLoadedOnce.current = true;
            setStatus(activeCompany.read_only ? "ready" : "locked");
            return;
        }

        // Sunucu taraflı lisans yoklaması + cihaz kaydı (her açılışta).
        // RPC henüz kurulmadıysa (migration çalıştırılmamış) sessizce geçilir —
        // kurulduktan sonra localStorage hilesiyle aşılamayan ikinci bir katman olur.
        try {
            let { data: licenseCheck, error: licenseErr } = await withTimeout(
                supabase.rpc("register_device_and_touch_login", {
                    p_device_id: getDeviceId(),
                    p_user_agent: navigator.userAgent.slice(0, 250),
                    p_device_name: [navigator.platform, navigator.language].filter(Boolean).join(" / ").slice(0, 120),
                }),
                "Lisans kontrolu",
            );
            if (licenseErr && /p_device_name|schema cache|function/i.test(String(licenseErr.message || ""))) {
                const retry = await withTimeout(
                    supabase.rpc("register_device_and_touch_login", {
                        p_device_id: getDeviceId(),
                        p_user_agent: navigator.userAgent.slice(0, 250),
                    }),
                    "Lisans kontrolu",
                );
                licenseCheck = retry.data;
                licenseErr = retry.error;
            }
            if (!licenseErr && typeof licenseCheck === "string") {
                if (licenseCheck === "suspended") {
                    setLockReason("inactive_company");
                    hasLoadedOnce.current = true;
                    setStatus("locked");
                    return;
                }
                if (licenseCheck === "expired") {
                    setLockReason("expired_trial");
                    hasLoadedOnce.current = true;
                    setStatus("locked");
                    return;
                }
                if (licenseCheck === "device_limit") {
                    setLockReason("device_limit");
                    hasLoadedOnce.current = true;
                    setStatus("locked");
                    return;
                }
            }
        } catch {
            // RPC yok ya da ağ hatası — mevcut istemci tarafı kontroller geçerli kalır
        }

            hasLoadedOnce.current = true;
            setStatus("ready");
        } catch (error) {
            console.error("Auth load failed:", error);
            if (isFirstLoad) {
                setUser(null);
                setCompany(null);
                setRole("unknown");
                setMemberRole("unknown");
                setLockReason(null);
                setAppReadOnlyMode(false);
                hasLoadedOnce.current = false;
                setStatus("unauthenticated");
            }
            // Arka plan auth yenileme hatası (sekme değişimi vb.):
            // Mevcut oturum durumunu koru, kullanıcıyı login'e yönlendirme.
        }
    };

    useEffect(() => {
        let alive = true;

        async function run() {
            if (alive) await loadAuth();
        }

        run();
        const { data } = supabase.auth.onAuthStateChange((event) => {
            if (!alive) return;
            // TOKEN_REFRESHED ve INITIAL_SESSION sekme değişiminde gereksiz
            // loadAuth() kaskadını tetikler — sadece gerçek kullanıcı değişikliklerinde çalış.
            if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
            // Yalnızca SIGNED_IN, SIGNED_OUT, USER_UPDATED eventlerinde yenile.
            if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
            window.setTimeout(() => {
                if (alive) void loadAuth();
            }, 0);
        });

        return () => {
            alive = false;
            data.subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (status !== "loading") return;

        const timer = window.setTimeout(() => {
            if (user) {
                setStatus("ready");
                return;
            }
            setUser(null);
            setCompany(null);
            setRole("unknown");
            setMemberRole("unknown");
            setLockReason(null);
            setAppReadOnlyMode(false);
            setStatus("unauthenticated");
        }, 6500);

        return () => window.clearTimeout(timer);
    }, [status, user]);

    const companyEnabledModules = company?.enabled_modules;
    const companyPackageCode = company?.package_code;
    const companySubscriptionPlan = company?.subscription_plan;

    const enabledModules = useMemo(() => {
        if (companyEnabledModules?.length) return normalizeEnabledModules(companyEnabledModules);
        const pkg = String(companyPackageCode || companySubscriptionPlan || "").toLowerCase();
        if (pkg === "solo" || pkg === "solo_perdeci") return SOLO_MODULES;
        if (pkg === "enterprise" || pkg === "lifetime" || pkg === "ekip") return ENTERPRISE_MODULES;
        if (pkg === "pro" || pkg === "yonetici") return PRO_MODULES;
        return CORE_MODULES;
    }, [companyEnabledModules, companyPackageCode, companySubscriptionPlan]);

    const value = useMemo<AuthContextValue>(() => ({
        status,
        user,
        role,
        companyId: company?.id ?? null,
        company,
        memberRole,
        readOnly: role === "super_admin" && Boolean(localStorage.getItem("demo_company_id")) && localStorage.getItem("demo_read_only") === "false"
            ? false
            : Boolean(company?.read_only) || lockReason === "read_only" || (role === "super_admin" && localStorage.getItem("demo_read_only") !== "false" && Boolean(localStorage.getItem("demo_company_id"))),
        enabledModules,
        hasModule: (module: string) => {
            if (role === "super_admin") return true;
            const aliases = MODULE_ALIASES[module] ?? [module];
            return aliases.some((item) => enabledModules.includes(item));
        },
        lockReason,
        refreshAuth: loadAuth,
    }), [company, enabledModules, lockReason, memberRole, role, status, user]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used within an AuthProvider");
    return context;
}
