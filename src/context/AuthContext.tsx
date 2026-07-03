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

export const CORE_MODULES = ["admin", "measurements", "orders", "customers", "appointments", "suppliers", "installation", "catalogs", "staff"];
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
    // Lisans kontrolünü cache'le — her açılışta RPC çalıştırma
    const licenseCheckCache = useRef<string | null>(null);
    const licenseCheckTime = useRef(0);
    // Mevcut status'ün async-güvenli kopyası (arka plan reload guard'ı için).
    const statusRef = useRef<AuthStatus>("loading");
    useEffect(() => { statusRef.current = status; }, [status]);

    const loadAuth = async (opts?: { forceLicense?: boolean; signedOut?: boolean }) => {
        const isFirstLoad = !hasLoadedOnce.current;
        // Arka plan reload'u (sekme dönüşü/token yenileme): status zaten "ready" ise
        // GEÇİCİ null session / profile-member-company sorgu hataları alt ağacı unmount
        // ETMEMELİ. Yalnız ilk yüklemede veya gerçek SIGNED_OUT'ta durum düşürülür.
        const guardTransient = !isFirstLoad && statusRef.current === "ready";
        try {
            if (isFirstLoad) {
                setStatus("loading");
                setLockReason(null);
            }

            const { data: sessionData } = await withTimeout(supabase.auth.getSession(), "Oturum kontrolu");
            const sessionUser = sessionData.session?.user ?? null;

            if (!sessionUser) {
                // Gerçek çıkış (SIGNED_OUT) → oturumu kapat. Aksi halde ready iken geçici
                // null session'ı (token yenileme yarışı) yut; mevcut oturum korunur.
                if (guardTransient && !opts?.signedOut) return;
                setUser(null);
                if (isFirstLoad) {
                    setCompany(null);
                    setRole("unknown");
                    setMemberRole("unknown");
                }
                hasLoadedOnce.current = false;
                setStatus("unauthenticated");
                return;
            }

            setUser(sessionUser);
            if (isFirstLoad) {
                setCompany(null);
                setRole("unknown");
                setMemberRole("unknown");
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
            if (guardTransient) return; // ready iken geçici profil sorgu hatası → mevcut durumu koru
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
            if (guardTransient) return; // ready iken geçici üyelik sorgu hatası → mevcut durumu koru
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
            if (guardTransient) return; // ready iken geçici firma sorgu hatası → mevcut durumu koru
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

        // Sunucu taraflı lisans yoklaması + cihaz kaydı (ilk yükleme ve periyodik olarak).
        // Arka plan refresh'lerinde (sekme değişimi vb.) cached sonuç kullan — gereksiz ağ isteği yapma.
        // RPC henüz kurulmadıysa (migration çalıştırılmamış) sessizce geçilir.
        try {
            const now = Date.now();
            const cacheAge = now - licenseCheckTime.current;
            const shouldRefreshLicense = !isFirstLoad && cacheAge > 5 * 60 * 1000; // 5 dakika sonra yenile

            // Kullanıcı "Tekrar Dene" derse (forceLicense) cache'i baypas edip sunucudan taze sonuç al.
            if (isFirstLoad || shouldRefreshLicense || opts?.forceLicense) {
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

                // Sonucu cache'le
                if (!licenseErr && typeof licenseCheck === "string") {
                    licenseCheckCache.current = licenseCheck;
                    licenseCheckTime.current = now;
                } else if (licenseErr) {
                    licenseCheckCache.current = null;
                }
            }

            // Cached sonuç varsa kullan
            const cachedResult = licenseCheckCache.current;
            if (cachedResult === "suspended") {
                setLockReason("inactive_company");
                hasLoadedOnce.current = true;
                setStatus("locked");
                return;
            }
            if (cachedResult === "expired") {
                setLockReason("expired_trial");
                hasLoadedOnce.current = true;
                setStatus("locked");
                return;
            }
            if (cachedResult === "device_limit") {
                setLockReason("device_limit");
                hasLoadedOnce.current = true;
                setStatus("locked");
                return;
            }
        } catch {
            // RPC yok ya da ağ hatası — cached sonuç var ise kullan, yoksa mevcut kontroller geçerli kalır
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
        let lastAuthRefresh = 0;
        let isPageVisible = true;

        async function run() {
            if (alive) await loadAuth();
        }

        run();

        // Sekme görünürlüğü takip et — arka plan yenilemelerini azalt
        const handleVisibilityChange = () => {
            isPageVisible = !document.hidden;
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);

        const { data } = supabase.auth.onAuthStateChange((event) => {
            if (!alive) return;
            // TOKEN_REFRESHED ve INITIAL_SESSION gereksiz — filtrele
            if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
            // Yalnızca gerçek kullanıcı değişikliklerinde çalış
            if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;

            // Çok sık refresh'leri engelleyelim (debounce: 1 saniye)
            const now = Date.now();
            if (now - lastAuthRefresh < 1000) return;
            lastAuthRefresh = now;

            // Sayfa görünür ise yenile; gerçek çıkış (SIGNED_OUT) görünürlükten bağımsız işlenir.
            const isSignedOut = event === "SIGNED_OUT";
            if (isPageVisible || isSignedOut) {
                window.setTimeout(() => {
                    if (alive) void loadAuth({ signedOut: isSignedOut });
                }, 0);
            }
        });

        return () => {
            alive = false;
            document.removeEventListener("visibilitychange", handleVisibilityChange);
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
            // Eğer bir kez yüklendi ise arka plan yenilemesindeyiz — state sıfırlamadan loading'i atla
            if (hasLoadedOnce.current) {
                setStatus("ready");
                return;
            }
            // İlk yükleme timeout — oturum yok, unauthenticated'e git
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
        let modules: string[] = [];

        if (companyEnabledModules?.length) {
            modules = normalizeEnabledModules(companyEnabledModules);
        } else {
            const pkg = String(companyPackageCode || companySubscriptionPlan || "").toLowerCase();
            if (pkg === "solo" || pkg === "solo_perdeci") modules = SOLO_MODULES;
            else if (pkg === "enterprise" || pkg === "lifetime" || pkg === "ekip") modules = ENTERPRISE_MODULES;
            else if (pkg === "pro" || pkg === "yonetici") modules = PRO_MODULES;
            else modules = CORE_MODULES;
        }

        // Test/demo şirketleri için suppliers ve installation modülünü garanti et
        const companyName = String(company?.name ?? "").toLowerCase();
        if (companyName.includes("test") || companyName.includes("demo")) {
            if (!modules.includes("suppliers")) modules = [...modules, "suppliers"];
            if (!modules.includes("installation")) modules = [...modules, "installation"];
        }

        return modules;
    }, [companyEnabledModules, companyPackageCode, companySubscriptionPlan, company?.name]);

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
        refreshAuth: () => loadAuth({ forceLicense: true }),
    }), [company, enabledModules, lockReason, memberRole, role, status, user]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used within an AuthProvider");
    return context;
}
