import { createClient } from "@supabase/supabase-js";
import { pickPrimaryMembership } from "./utils/trialLicense";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URI;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let isReadOnly = false;

export const READ_ONLY_MESSAGE =
    "Bu hesap salt okunur modda. Değişiklik yapmak için aktif/yazma yetkili hesap kullanın.";

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

    const { data: cmRows, error: cmErr } = await supabase
        .from("company_members")
        .select("company_id,is_active,created_at,companies(*)")
        .eq("user_id", user.id);

    if (cmErr) throw cmErr;
    const cm = pickPrimaryMembership(cmRows as any[] | null) as { company_id?: string } | null;
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
            const accessRpc = /\/rest\/v1\/rpc\/(get_current_auth_context|register_device_and_touch_login|complete_pending_invite_for_current_user|accept_invite_code_for_current_user|accept_invite_for_current_user|get_invite_by_token|get_invite_by_email_code)$/.test(new URL(urlStr, window.location.href).pathname);
            if (!urlStr.includes("/auth/v1/") && !accessRpc) {
                showPurchaseRequired();
                // supabase-js (postgrest) hata metnini gövdedeki `message` alanından okur;
                // `error` alanı kullanılırsa kullanıcıya "undefined" gösterilir.
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            code: "READ_ONLY_MODE",
                            message: READ_ONLY_MESSAGE,
                            details: null,
                            hint: null,
                            error: READ_ONLY_MESSAGE,
                        }),
                        {
                            status: 403,
                            statusText: "Forbidden",
                            headers: { "Content-Type": "application/json" },
                        }
                    )
                );
            }
        }
    }

    const requestUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    const endpoint = new URL(requestUrl, window.location.href).pathname;
    const reportable = endpoint.startsWith("/rest/v1/") && !endpoint.endsWith("/report_client_error");
    try {
        const response = await window.fetch(input, init);
        if (reportable && !response.ok) {
            // No request bodies, query strings, credentials or customer values.
            console.error(`Veritabanı isteği başarısız: ${endpoint} (HTTP ${response.status})`);
            // Sunucu, deneme/abonelik süresi dolduğu için yazmayı reddettiyse mevcut
            // satın alma/abonelik ekranını göster (istemci henüz salt okunura geçmemiş olabilir).
            if (response.status >= 400 && response.status < 500) {
                void response
                    .clone()
                    .text()
                    .then((body) => {
                        if (body.includes("PERDEPRO_SUBSCRIPTION_READ_ONLY")) {
                            setAppReadOnlyMode(true);
                            showPurchaseRequired();
                        }
                    })
                    .catch(() => undefined);
            }
        }
        return response;
    } catch (error) {
        if (reportable) console.error(`Veritabanı bağlantısı kurulamadı: ${endpoint}`);
        throw error;
    }
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "perdepro-auth",
    },
    global: {
        fetch: customFetch,
    },
});

if (typeof window !== "undefined") {
    (window as any).supabase = supabase;
}
