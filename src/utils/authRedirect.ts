import { Capacitor } from "@capacitor/core";

/**
 * E-posta doğrulama ve şifre sıfırlama bağlantılarının döneceği adres.
 *
 * - Web: uygulamanın açık olduğu adres (ör. https://app.example.com/#/auth/callback).
 * - Android / iOS (Capacitor): uygulama URL scheme'i kullanılır.
 * - Windows (Electron, file://): VITE_PUBLIC_APP_URL kullanılır.
 */
export function isEmbeddedAppRuntime(): boolean {
    if (typeof window === "undefined") return true;
    if (window.location.protocol === "file:") return true;
    if (isNativeCapacitor()) return true;
    return !/^https?:$/.test(window.location.protocol);
}

function isNativeCapacitor(): boolean {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
}

function configuredPublicAppUrl(): string | null {
    const raw = String(import.meta.env.VITE_PUBLIC_APP_URL || "").trim();
    if (!raw || !/^https?:\/\//i.test(raw)) return null;
    // Sondaki "#..." ve "/" temizlenir; hash router yolu aşağıda eklenir.
    return raw.replace(/#.*$/, "").replace(/\/+$/, "");
}

export function getAuthRedirectUrl(path: "/auth/callback" | "/reset-password"): string | undefined {
    if (isNativeCapacitor()) {
        return "com.curtainsaas.app://auth/callback";
    }

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

/** Capacitor deeplink query/hash verisini HashRouter auth rotasina tasir. */
export function getNativeAuthCallbackHash(rawUrl: string): string | null {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "com.curtainsaas.app:") return null;
        if (url.hostname && url.hostname !== "auth") return null;
        const path = url.pathname.replace(/^\/+/, "");
        const route = path === "reset-password" ? "/reset-password" : "/auth/callback";
        const params = new URLSearchParams(url.search);
        const fragment = url.hash.replace(/^#/, "");
        if (fragment) new URLSearchParams(fragment).forEach((value, key) => params.set(key, value));
        return `#${route}${params.size ? `?${params.toString()}` : ""}`;
    } catch {
        return null;
    }
}

/** Hash router ile gelen auth parametrelerini (hash + query) tek yerde toplar. */
export function readAuthParamsFromLocation(): URLSearchParams {
    const hash = window.location.hash || "";
    const query = window.location.search || "";
    const firstHashPayload = hash.startsWith("#/")
        ? (hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "")
        : hash.replace(/^#/, "");
    const parts = [
        query.startsWith("?") ? query.slice(1) : query,
        firstHashPayload,
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
