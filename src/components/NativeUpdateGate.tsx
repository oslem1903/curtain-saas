import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "../supabaseClient";
import { nativePlatform, openExternalUrl } from "../utils/nativeRuntime";
import { requiresNativeUpdate, type NativeUpdatePolicy } from "../utils/nativeUpdatePolicy";

const CURRENT_VERSION = String(import.meta.env.VITE_APP_VERSION || "0.0.0");

/** Public release metadata only: works before authentication and on the setup screen. */
export default function NativeUpdateGate({ children }: { children: ReactNode }) {
    const [policy, setPolicy] = useState<NativeUpdatePolicy | null>(null);
    const retryRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (nativePlatform() !== "ios") return;
        let alive = true;
        let controller: AbortController | null = null;
        async function check() {
            // Focus, online and interval events must not create overlapping requests.
            if (controller) return;
            controller = new AbortController();
            const timeout = window.setTimeout(() => controller?.abort(), 8000);
            try {
                const { data, error } = await supabase.from("app_platform_releases")
                    .select("platform,minimum_version,store_url,enabled")
                    .eq("platform", "ios").abortSignal(controller.signal).maybeSingle();
                if (alive && !error) setPolicy(data as NativeUpdatePolicy | null);
                // On error retain a previously confirmed requirement; an initial outage
                // or a not-yet-installed migration must not lock out all users.
            } catch { /* Network failures are retried on resume, online or timer. */ }
            finally {
                window.clearTimeout(timeout);
                controller = null;
            }
        }
        const onVisible = () => { if (document.visibilityState === "visible") void check(); };
        retryRef.current = () => { void check(); };
        void check();
        const interval = window.setInterval(() => { void check(); }, 60_000);
        window.addEventListener("focus", onVisible);
        window.addEventListener("online", onVisible);
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            alive = false;
            controller?.abort();
            retryRef.current = null;
            window.clearInterval(interval);
            window.removeEventListener("focus", onVisible);
            window.removeEventListener("online", onVisible);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, []);

    if (!requiresNativeUpdate(policy, nativePlatform(), CURRENT_VERSION)) return children;
    return (
        <main className="min-h-[100dvh] flex items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
            <section aria-labelledby="required-update-title" className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-xl dark:bg-slate-900">
                <h1 id="required-update-title" className="text-2xl font-bold text-slate-900 dark:text-white">PerdePRO’yu güncelleyin</h1>
                <p className="mt-4 text-slate-600 dark:text-slate-300">Devam etmek için en az {policy?.minimum_version} sürümü gerekiyor. Hesabınız ve verileriniz korunur.</p>
                <button type="button" onClick={() => openExternalUrl(policy!.store_url)} className="mt-6 w-full rounded-xl bg-indigo-600 p-3 font-bold text-white">App Store’da güncelle</button>
                <button type="button" onClick={() => retryRef.current?.()} className="mt-3 w-full rounded-xl border border-slate-300 p-3 font-bold text-slate-700 dark:text-slate-200">Tekrar kontrol et</button>
            </section>
        </main>
    );
}
