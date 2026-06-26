/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
export const SOLO_MODULES = ["admin", "measurements", "orders", "customers", "appointments", "suppliers", "installation", "catalogs", "staff"];
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
type LockReason = "inactive_user" | "inactive_member" | "inactive_company" | "expired_trial" | "read_only" | "unknown";

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

    const loadAuth = async () => {
        try {
            setStatus("loading");
            setLockReason(null);

            const { data: sessionData } = await withTimeout(supabase.auth.getSession(), "Oturum kontrolu");
            const sessionUser = sessionData.session?.user ?? null;

            setUser(sessionUser);
            setCompany(null);
            setRole("unknown");
            setMemberRole("unknown");

            if (!sessionUser) {
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
            setStatus("unauthorized");
            return;
        }

        if (profile.is_active === false) {
            setLockReason("inactive_user");
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
            setStatus("unauthorized");
            return;
        }

        if (member.is_active === false) {
            setLockReason("inactive_member");
            setStatus("locked");
            return;
        }

        const rowCompany = Array.isArray(member.companies) ? member.companies[0] : member.companies;
        const activeCompany = rowCompany as CompanyState | null;

        if (!activeCompany?.id) {
            setStatus("unauthorized");
            return;
        }

        setCompany(activeCompany);
        setAppReadOnlyMode(Boolean(activeCompany.read_only) || isTrialExpired(activeCompany));
        setMemberRole(normalizeRole(member.role) === "unknown" ? profileRole : normalizeRole(member.role));

        if (activeCompany.is_active === false || String(activeCompany.plan_status ?? "").toLowerCase() === "suspended") {
            setLockReason("inactive_company");
            setStatus("locked");
            return;
        }

        if (isTrialExpired(activeCompany)) {
            setLockReason(activeCompany.read_only ? "read_only" : "expired_trial");
            setStatus(activeCompany.read_only ? "ready" : "locked");
            return;
        }

            setStatus("ready");
        } catch (error) {
            console.error("Auth load failed:", error);
            setUser(null);
            setCompany(null);
            setRole("unknown");
            setMemberRole("unknown");
            setLockReason(null);
            setAppReadOnlyMode(false);
            setStatus("unauthenticated");
        }
    };

    useEffect(() => {
        let alive = true;

        async function run() {
            if (alive) await loadAuth();
        }

        run();
        const { data } = supabase.auth.onAuthStateChange((event) => {
            if (!alive || event === "INITIAL_SESSION") return;
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
        if (companyPackageCode === "solo") return SOLO_MODULES;
        if (companySubscriptionPlan === "enterprise" || companySubscriptionPlan === "lifetime") {
            return ENTERPRISE_MODULES;
        }
        if (companySubscriptionPlan === "pro") {
            return PRO_MODULES;
        }
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
