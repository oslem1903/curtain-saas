import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function ModuleGate({ module, children }: { module: string; children: ReactNode }) {
    const { hasModule, company } = useAuth();

    if (hasModule(module)) return <>{children}</>;

    return (
        <div className="m-4 rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-900">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-amber-700 shadow-sm">
                <LockKeyhole className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-black">Bu modul paketinizde yok</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6">
                {company?.subscription_plan || "starter"} paketinde bu alan kapali. Muhasebe, tedarikci, gider, kar, sube ve gelismis raporlar için paketi yukseltin.
            </p>
            <button type="button" className="mt-5 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white">
                Satın Al / Yukselt
            </button>
        </div>
    );
}
