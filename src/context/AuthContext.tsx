/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, setAppReadOnlyMode } from "../supabaseClient";
import { normalizeRole, type RoleState } from "../auth/roles";
import { isTrialExpired, pickPrimaryMembership } from "../utils/trialLicense";
import { friendlyInviteJoinError } from "../utils/inviteJoin";
import { clearStorageUrlCache } from "../utils/storageUrl";

type CompanyState = {
    id: string;
    name: string | null;
    is_active: boolean | null;
    read_only: boolean | null;
    plan_status: string | null;
    subscription_plan: string | null;
    max_users: number | null;
    max_devices: number | null;
    enabled_modules: string[] | null;
    package_code?: string | null;
    branch_limit: number | null;
    trial_end: string | null;
    trial_ends_at: string | null;
    is_pilot: boolean | null;
    /** Migration 026: ozel erisim bitisi (NULL = suresiz). 026 calistirilmadan once undefined. */
    pilot_until?: string | null;
    onboarding_completed?: boolean;
    onboarding_completed_at?: string | null;
    subscription_status?: string;
    license_expires_at?: string | null;
    payment_reference?: string | null;
    billing_note?: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    tax_office: string | null;
    tax_no: string | null;
    logo_url: string | null;
};

export const CORE_MODULES = ["admin", "measurements", "orders", "customers", "appointments", "catalogs", "staff"];
// Solo Perdeci: kartela (catalogs) ve personel (staff) modülleri pakete dahil DEĞİL
// "collections" (Tahsilatlar): Solo'da Muhasebe menüsü olmadığı için ayrı bir
// tahsilat ekranı sunar. PRO/ENTERPRISE de SOLO_MODULES'u spread ettiği için bu
// modülü teknik olarak "sahip" olur — ama Tahsilatlar menü öğesi ayrıca
// hasModule("accounting") kontrolüyle bastırılır (bkz. Layout.tsx), böylece
// Muhasebesi olan paketlerde ikinci bir menü oluşmaz.
export const SOLO_MODULES = ["admin", "measurements", "orders", "customers", "appointments", "suppliers", "installation", "collections"];
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
    collections: ["collections"],
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

// needs_setup: oturum var, profil var ama hiçbir firmaya üyelik yok (kodsuz kayıt
// sonrası işletme henüz oluşturulmadı ya da davet henüz kabul edilmedi).
type AuthStatus = "loading" | "unauthenticated" | "ready" | "unauthorized" | "locked" | "needs_setup" | "access_error";
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
    isPasswordRecovery: boolean;
    accessError: string | null;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Geçici ağ/sunucu hatalarında (zaman aşımı, 5xx, kopan bağlantı) sorguyu bir kez
 * daha dener.
 *
 * Kök neden: profil ve firma üyeliği sorguları TEK denemeydi; mobilde ya da zayıf
 * bağlantıda dönen geçici bir hata doğrudan `unauthorized` durumuna düşürüyordu ve
 * kullanıcı, üyeliği gayet yerinde olduğu hâlde "Yetki bulunamadı" ekranında
 * kalıyordu. Yeniden deneme YALNIZCA hata durumunda yapılır; "sonuç boş" (gerçekten
 * üyelik yok) durumunda tekrar denenmez — güvenlik kararı fail-closed kalır.
 */
async function retryOnError<T extends { error: unknown }>(
    run: () => PromiseLike<T>,
    attempts = 2,
    delayMs = 600,
): Promise<T> {
    let last: T | undefined;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const result = await run();
            if (!result.error) return result;
            last = result;
        } catch (error) {
            if (attempt === attempts - 1) throw error;
        }
        if (attempt < attempts - 1) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
    }
    return last as T;
}

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

export function AuthProvider({ children }: { children: ReactNode }) {
    const [accessError, setAccessError] = useState<string | null>(null);
    const loadQueue = useRef<Promise<void> | null>(null);
    const lastUserId = useRef<string | null>(null);
    const [status, setStatus] = useState<AuthStatus>("loading");
    const [user, setUser] = useState<User | null>(null);
    const [role, setRole] = useState<RoleState>("unknown");
    const [memberRole, setMemberRole] = useState<RoleState>("unknown");
    const [company, setCompany] = useState<CompanyState | null>(null);
    const [lockReason, setLockReason] = useState<LockReason | null>(null);
    const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
    // İlk yükleme tamamlandı mı? Arka plan refresh'lerinde loading ekranı gösterme.
    const hasLoadedOnce = useRef(false);

    const loadAuthNow = useCallback(async () => {
        let completingInvite = false;
        setAccessError(null);
        const isFirstLoad = !hasLoadedOnce.current;
        try {
            if (isFirstLoad) {
                setStatus("loading");
                setLockReason(null);
            }

            const { data: sessionData, error: sessionError } = await withTimeout(supabase.auth.getSession(), "Oturum kontrolu");
            if (sessionError) throw sessionError;
            const sessionUser = sessionData.session?.user ?? null;

            const identityChanged = lastUserId.current !== (sessionUser?.id ?? null);
            lastUserId.current = sessionUser?.id ?? null;
            setUser(sessionUser);
            if (isFirstLoad || identityChanged) {
                setStatus("loading");
                setCompany(null);
                setRole("unknown");
                setMemberRole("unknown");
            }

            if (!sessionUser) {
                // Oturum yoksa imzali Storage adreslerini de birak (bir sonraki
                // kullaniciya onceki firmanin adresleri sizmasin).
                clearStorageUrlCache();
                hasLoadedOnce.current = false;
                setCompany(null);
                setRole("unknown");
                setMemberRole("unknown");
                setAppReadOnlyMode(false);
                setStatus("unauthenticated");
                return;
            }

            if (sessionUser.user_metadata?.perdepro_invite) {
                completingInvite = true;
                const { error } = await withTimeout(supabase.rpc("complete_pending_invite_for_current_user"), "Davet tamamlama", 15000);
                if (error) throw error;
                completingInvite = false;
            }

            const { data: rpcProfile, error: rpcProfileError } = await retryOnError(() =>
                withTimeout(supabase.rpc("get_current_auth_context"), "Yetki kontrolu"),
            );

        let profile = Array.isArray(rpcProfile) ? rpcProfile[0] : rpcProfile;
        // RPC eski kurulumda yoksa yalnizca Auth ID ile ara; e-posta yetki kaniti degildir.
        if (rpcProfileError && !["PGRST202", "42883"].includes(rpcProfileError.code)) throw rpcProfileError;
        if (!profile?.role) {
            const byUserId = await withTimeout(
                supabase.from("profiles").select("role,is_active").eq("user_id", sessionUser.id).maybeSingle(), "Profil kontrolu",
            );
            if (byUserId.error) throw byUserId.error;
            profile = byUserId.data;
        }
        if (!profile) {
            hasLoadedOnce.current = false;
            setStatus("needs_setup");
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
                const { data: demoCompany, error: demoError } = await withTimeout(
                    supabase
                        .from("companies")
                        .select("*") // 026 oncesi/sonrasi kolon farklarina dayanikli (pilot_until)
                        .eq("id", demoCompanyId)
                        .maybeSingle(),
                    "Demo firma kontrolu",
                );

                if (demoError) throw demoError;
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
            hasLoadedOnce.current = true;
            setStatus("ready");
            return;
        }

            const { data: memberRows, error: memberError } = await retryOnError(() =>
                withTimeout(
                    supabase
                        .from("company_members")
                        .select("company_id,role,is_active,created_at,companies(*)")
                        .eq("user_id", sessionUser.id),
                    "Firma uyeligi kontrolu",
                ),
            );
        if (memberError) throw memberError;
        if (!Array.isArray(memberRows)) throw new Error("Membership response missing");
        const member = pickPrimaryMembership(memberRows as any[] | null) as any;

        // Sorgu BAŞARILI ve gerçekten hiç üyelik yok: hesap kurulumu ekranı.
        // (Geçici ağ hatasında burası çalışmaz; aşağıdaki fail-closed dal korunur.)
        if (!memberError && Array.isArray(memberRows) && memberRows.length === 0) {
            setAppReadOnlyMode(false);
            hasLoadedOnce.current = false;
            setStatus("needs_setup");
            return;
        }

        if (memberError || !member?.company_id) {
            hasLoadedOnce.current = false;
            throw new Error("Access data incomplete");
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
            throw new Error("Access data incomplete");
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
            // Suresi dolan hesap kilitlenmez: salt okunur modda girer.
            setLockReason(activeCompany.read_only ? "read_only" : "expired_trial");
            hasLoadedOnce.current = true;
            setStatus("ready");
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
                    // Sunucu da suresi dolmus diyor: kilitleme, salt okunur gir.
                    setLockReason("expired_trial");
                    setAppReadOnlyMode(true);
                    hasLoadedOnce.current = true;
                    setStatus("ready");
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
            console.error("Auth access check failed", error);
            setCompany(null);
            setRole("unknown");
            setMemberRole("unknown");
            setLockReason(null);
            setAppReadOnlyMode(false);
            hasLoadedOnce.current = false;
            setAccessError(completingInvite ? friendlyInviteJoinError(error) : "Hesap ve firma bilgileriniz şu anda kontrol edilemiyor. Bağlantınızı kontrol edip tekrar deneyin.");
            setStatus("access_error");
        }
    }, []);

    // Davet oncesindeki eski sorgu, kabul sonrasi yenilemenin ustune yazmasin.
    const loadAuth = useCallback(() => {
        const next = (loadQueue.current ?? Promise.resolve()).then(loadAuthNow);
        loadQueue.current = next;
        void next.finally(() => { if (loadQueue.current === next) loadQueue.current = null; });
        return next;
    }, [loadAuthNow]);

    useEffect(() => {
        let alive = true;

        async function run() {
            if (alive && !loadQueue.current) await loadAuth();
        }

        run();
        const { data } = supabase.auth.onAuthStateChange((event) => {
            if (!alive) return;
            // PASSWORD_RECOVERY event: user authenticated for recovery, redirect to reset password
            if (event === "PASSWORD_RECOVERY") {
                setIsPasswordRecovery(true);
                setStatus("ready");
                return;
            }
            // TOKEN_REFRESHED ve INITIAL_SESSION sekme değişiminde gereksiz
            // loadAuth() kaskadını tetikler — sadece gerçek kullanıcı değişikliklerinde çalış.
            if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
            // Yalnızca SIGNED_IN, SIGNED_OUT, USER_UPDATED eventlerinde yenile.
            if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
            if (event === "SIGNED_OUT" || event === "SIGNED_IN") clearStorageUrlCache();
            setIsPasswordRecovery(false);
            window.setTimeout(() => {
                if (alive) void loadAuth();
            }, 0);
        });

        return () => {
            alive = false;
            data.subscription.unsubscribe();
        };
    }, [loadAuth]);

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
            : Boolean(company?.read_only) || lockReason === "read_only" || lockReason === "expired_trial" || (role === "super_admin" && localStorage.getItem("demo_read_only") !== "false" && Boolean(localStorage.getItem("demo_company_id"))),
        enabledModules,
        hasModule: (module: string) => {
            if (role === "super_admin" && !localStorage.getItem("demo_company_id")) return true;
            const aliases = MODULE_ALIASES[module] ?? [module];
            return aliases.some((item) => enabledModules.includes(item));
        },
        lockReason,
        refreshAuth: loadAuth,
        isPasswordRecovery,
        accessError,
    }), [company, enabledModules, lockReason, memberRole, role, status, user, isPasswordRecovery, accessError, loadAuth]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used within an AuthProvider");
    return context;
}
