import { ShieldAlert } from "lucide-react";
import { supabase } from "../supabaseClient";

export default function Unauthorized() {
    async function logout() {
        await supabase.auth.signOut();
        window.location.hash = "#/login";
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
            <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
                    <ShieldAlert className="h-8 w-8" />
                </div>
                <h1 className="text-2xl font-black text-slate-900 dark:text-white">Yetki bulunamadi</h1>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Bu kullanici herhangi bir firma uyeligiyle eslesmiyor. Giriş için Super Admin veya firma yoneticisinin daveti gerekir.
                </p>
                <button
                    type="button"
                    onClick={logout}
                    className="mt-6 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white hover:bg-slate-800"
                >
                    Cikis Yap
                </button>
            </div>
        </div>
    );
}
