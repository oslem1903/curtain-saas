import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { useAuth } from "../context/AuthContext";

/** Firma sahibine ozel ekranlar (kullanici yonetimi, abonelik, firma ayarlari). Ekip uyeleri gorur: yetki yok. */
export default function OwnerGate({ children }: { children: ReactNode }) {
    const { isOwner } = useAuth();
    if (isOwner) return <>{children}</>;
    return (
        <div className="m-4 rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm dark:bg-slate-800">
                <LockKeyhole className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-black">Bu ekran için yetkiniz yok</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6">Bu bölümü yalnızca firma sahibi kullanabilir.</p>
        </div>
    );
}
