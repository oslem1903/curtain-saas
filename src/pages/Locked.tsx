import { LockKeyhole } from "lucide-react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";

const reasonText: Record<string, string> = {
    inactive_user: "Kullanici hesabi pasif durumda.",
    inactive_member: "Firma içindeki kullanici uyeligi pasif durumda.",
    inactive_company: "Firma hesabi pasif veya askida.",
    expired_trial: "Deneme suresi sona ermis.",
    read_only: "Firma sadece okuma modunda.",
    unknown: "Hesap gecici olarak kilitli.",
};

export default function Locked() {
    const { lockReason, company } = useAuth();

    async function logout() {
        await supabase.auth.signOut();
        window.location.hash = "#/login";
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
            <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700">
                    <LockKeyhole className="h-8 w-8" />
                </div>
                <h1 className="text-2xl font-black text-slate-900 dark:text-white">Erisim kilitli</h1>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {reasonText[lockReason || "unknown"]} {company?.name ? `${company.name} için lisans veya yetki durumunu kontrol edin.` : "Lutfen yoneticiyle iletisime gecin."}
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
