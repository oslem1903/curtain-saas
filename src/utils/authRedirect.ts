import { Capacitor } from "@capacitor/core";

/**
 * E-posta doğrulama ve şifre sıfırlama bağlantılarının döneceği adres.
 *
 * - Web: uygulamanın açık olduğu adres (ör. https://app.example.com/#/auth/callback).
 * - Android / iOS (Capacitor) ve Windows (Electron, file://): uygulamanın kendi
 *   adresi e-postadan açılamaz (https://localhost, capacitor://, file://).
 *   Bu durumda VITE_PUBLIC_APP_URL (yayındaki web sürümü) kullanılır.
 *   Tanımlı değilse `undefined` döner ve Supabase panelindeki "Site URL"
 *   kullanılır.
 */
export function isEmbeddedAppRuntime(): boolean {
    if (typeof window === "undefined") return true;
    if (window.location.protocol === "file:") return true;
    try {
        if (Capacitor.isNativePlatform()) return true;
    } catch {
        // Capacitor yoksa web kabul edilir.
    }
    return !/^https?:$/.test(window.location.protocol);
}

function configuredPublicAppUrl(): string | null {
    const raw = String(import.meta.env.VITE_PUBLIC_APP_URL || "").trim();
    if (!raw || !/^https?:\/\//i.test(raw)) return null;
    // Sondaki "#..." ve "/" temizlenir; hash router yolu aşağıda eklenir.
    return raw.replace(/#.*$/, "").replace(/\/+$/, "");
}

export function getAuthRedirectUrl(path: "/auth/callback" | "/reset-password"): string | undefined {
    if (path === "/reset-password") {
        const legacy = String(import.meta.env.VITE_PASSWORD_RESET_REDIRECT_URL || "").trim();
        if (legacy && /^https?:\/\//i.test(legacy)) return legacy;
    }

    if (!isEmbeddedAppRuntime()) {
        return `${window.location.origin}${window.location.pathname}#${path}`;
    }

    const base = configuredPublicAppUrl();
    return base ? `${base}/#${path}` : undefined;
}

/** Hash router ile gelen auth parametrelerini (hash + query) tek yerde toplar. */
export function readAuthParamsFromLocation(): URLSearchParams {
    const hash = window.location.hash || "";
    const query = window.location.search || "";
    const parts = [
        query.startsWith("?") ? query.slice(1) : query,
        ...hash.split("#").slice(1).map((part) => (part.startsWith("/") ? part.split("?").slice(1).join("?") : part)),
    ].filter(Boolean);
    return new URLSearchParams(parts.join("&"));
}

/** Supabase Site URL'e dondugunde hash parametrelerini HashRouter rotasina tasi. */
export function routeAuthCallback() {
    const params = readAuthParamsFromLocation();
    if (!["access_token", "code", "token_hash", "error_description", "error"].some(key => params.has(key))) return;
    const route = window.location.hash.startsWith("#/reset-password") ? "/reset-password" : "/auth/callback";
    window.history.replaceState(null, document.title, `${window.location.pathname}#${route}?${params.toString()}`);
}
