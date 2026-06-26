import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URI;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let isReadOnly = false;

export function setAppReadOnlyMode(status: boolean) {
    isReadOnly = status;
}

export function setDemoTenantContext(companyId: string, readOnly = true) {
    localStorage.setItem("demo_company_id", companyId);
    localStorage.setItem("demo_read_only", readOnly ? "true" : "false");
    setAppReadOnlyMode(readOnly);
}

export function clearDemoTenantContext() {
    localStorage.removeItem("demo_company_id");
    localStorage.removeItem("demo_read_only");
    localStorage.removeItem("demo_viewing_role");
    localStorage.removeItem("demo_viewing_user_id");
    setAppReadOnlyMode(false);
}

export async function getEffectiveTenantContext() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;

    const user = data.user;
    if (!user) throw new Error("Oturum bulunamadı.");

    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

    const role = String(profile?.role ?? "").toLowerCase();
    const demoCompanyId = localStorage.getItem("demo_company_id");

    if (role === "super_admin" && demoCompanyId) {
        return {
            user,
            company_id: demoCompanyId,
            isDemoTenant: true,
            readOnly: localStorage.getItem("demo_read_only") !== "false",
        };
    }

    const { data: cm, error: cmErr } = await supabase
        .from("company_members")
        .select("company_id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (cmErr) throw cmErr;
    if (!cm?.company_id) throw new Error("Firma bağlantısı bulunamadı.");

    return {
        user,
        company_id: cm.company_id as string,
        isDemoTenant: false,
        readOnly: false,
    };
}

function showPurchaseRequired() {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("trial-expired-action"));
    }
}

const customFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isReadOnly && init?.method) {
        const method = init.method.toUpperCase();
        if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
            const urlStr = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
            if (!urlStr.includes("/auth/v1/")) {
                showPurchaseRequired();
                return Promise.resolve(
                    new Response(JSON.stringify({ error: "Trial expired. Read-only mode active." }), {
                        status: 403,
                        statusText: "Forbidden",
                    })
                );
            }
        }
    }

    return window.fetch(input, init);
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "curtain-saas-auth",
    },
    global: {
        fetch: customFetch,
    },
});

if (typeof window !== "undefined") {
    (window as any).supabase = supabase;
}
