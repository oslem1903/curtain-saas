// ============================================================
// Global console / hata yakalayıcı
// Son N hatayı bir halka tamponunda (ring buffer) tutar.
// "Sorun Bildir" anında bu kayıtlar destek talebine eklenir;
// böylece kullanıcı sadece "sipariş görünmüyor" yazsa bile
// süper admin arkadaki hatayı görebilir.
//
// Hiçbir yere otomatik göndermez — yalnızca bellekte tutar.
// ============================================================

export interface CapturedError {
    type: "error" | "warn" | "onerror" | "unhandledrejection";
    message: string;
    detail?: string;     // stack veya ek bilgi (kısaltılmış)
    route: string;
    at: string;          // ISO timestamp
}

const MAX_ENTRIES = 30;
const buffer: CapturedError[] = [];
let installed = false;

function trim(value: unknown, max = 600): string {
    let str: string;
    if (value instanceof Error) {
        str = `${value.name}: ${value.message}`;
    } else if (typeof value === "string") {
        str = value;
    } else {
        try {
            str = JSON.stringify(value);
        } catch {
            str = String(value);
        }
    }
    return str.length > max ? str.slice(0, max) + "…" : str;
}

function push(entry: CapturedError) {
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer.shift();
}

function currentRoute(): string {
    return window.location.hash || window.location.pathname || "/";
}

export function installConsoleCapture() {
    if (installed || typeof window === "undefined") return;
    installed = true;

    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);

    console.error = (...args: unknown[]) => {
        try {
            push({
                type: "error",
                message: args.map((a) => trim(a, 200)).join(" "),
                detail: args.find((a) => a instanceof Error) instanceof Error
                    ? trim((args.find((a) => a instanceof Error) as Error).stack)
                    : undefined,
                route: currentRoute(),
                at: new Date().toISOString(),
            });
        } catch { /* yakalayıcı asla uygulamayı bozmamalı */ }
        origError(...args);
    };

    console.warn = (...args: unknown[]) => {
        try {
            push({
                type: "warn",
                message: args.map((a) => trim(a, 200)).join(" "),
                route: currentRoute(),
                at: new Date().toISOString(),
            });
        } catch { /* sessiz */ }
        origWarn(...args);
    };

    window.addEventListener("error", (e: ErrorEvent) => {
        push({
            type: "onerror",
            message: trim(e.message, 300),
            detail: e.error instanceof Error ? trim(e.error.stack) : `${e.filename}:${e.lineno}:${e.colno}`,
            route: currentRoute(),
            at: new Date().toISOString(),
        });
    });

    window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
        push({
            type: "unhandledrejection",
            message: trim(e.reason?.message ?? e.reason, 300),
            detail: e.reason instanceof Error ? trim(e.reason.stack) : undefined,
            route: currentRoute(),
            at: new Date().toISOString(),
        });
    });
}

/** Son yakalanan hata/uyarı kayıtlarının kopyası (en yeni sonda). */
export function getCapturedErrors(): CapturedError[] {
    return buffer.slice();
}

/** Yalnızca gerçek hataları (warn hariç) verir — destek talebi için. */
export function getCapturedErrorsForSupport(limit = 15): CapturedError[] {
    return buffer
        .filter((e) => e.type !== "warn")
        .slice(-limit);
}

export function clearCapturedErrors() {
    buffer.length = 0;
}
