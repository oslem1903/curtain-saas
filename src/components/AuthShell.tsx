/* eslint-disable react-refresh/only-export-components */
import type { FocusEvent, ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

/**
 * Giriş / kayıt / kurulum ekranlarının ortak çerçevesi.
 *
 * Telefon klavyesi açıldığında görünür alan küçülür. Kart dikeyde ortalanırsa
 * üst kısmı ekran dışına itilir ve butonlara ulaşılamaz; bu yüzden küçük
 * ekranlarda içerik üstten başlar ve sayfa kaydırılabilir kalır. Odaklanan alan
 * klavyenin altında kalmasın diye görünür alana kaydırılır.
 */
export function scrollFieldIntoView(event: FocusEvent<HTMLElement>) {
    const target = event.currentTarget;
    window.setTimeout(() => {
        try {
            target.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch {
            // Eski WebView'larda seçenek nesnesi desteklenmeyebilir.
        }
    }, 280);
}

export default function AuthShell({
    title,
    subtitle,
    icon,
    children,
    footer,
}: {
    title: string;
    subtitle?: ReactNode;
    icon?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
}) {
    return (
        <div
            className="min-h-[100dvh] overflow-y-auto bg-slate-50 dark:bg-slate-950 flex justify-center items-start sm:items-center px-4"
            style={{
                paddingTop: "max(1.25rem, env(safe-area-inset-top))",
                paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
            }}
        >
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl overflow-hidden">
                <div className="px-6 sm:px-7 pt-7 pb-4">
                    <div className="w-12 h-12 rounded-2xl bg-primary-600 text-white flex items-center justify-center shadow-lg shadow-primary-600/20 mb-4">
                        {icon ?? <ShieldCheck className="w-7 h-7" />}
                    </div>
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white">{title}</h1>
                    {subtitle ? <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</div> : null}
                </div>
                <div className="px-6 sm:px-7 pb-6">{children}</div>
                {footer ? (
                    <div className="border-t border-slate-200 dark:border-slate-800 px-6 sm:px-7 py-4 bg-slate-50/70 dark:bg-slate-950/40">
                        {footer}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export const authInputClass =
    "w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-base text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60";

export const authLabelClass = "text-xs font-bold text-slate-500 uppercase tracking-wider";

export const authPrimaryButtonClass =
    "w-full h-12 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-black shadow-lg shadow-primary-600/20 transition inline-flex items-center justify-center gap-2 disabled:opacity-60";

export const authSecondaryButtonClass =
    "w-full h-12 rounded-2xl border-2 border-primary-600 text-primary-700 dark:text-primary-300 dark:border-primary-500 bg-white dark:bg-slate-900 hover:bg-primary-50 dark:hover:bg-slate-800 font-black transition inline-flex items-center justify-center gap-2 disabled:opacity-60";

export function AuthMessage({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
    const toneClass =
        tone === "error"
            ? "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-200 dark:border-red-900"
            : tone === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900"
              : "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700";
    return (
        <div role={tone === "error" ? "alert" : "status"} className={`rounded-2xl border px-4 py-3 text-sm font-medium ${toneClass}`}>
            {children}
        </div>
    );
}
