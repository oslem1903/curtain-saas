import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import AuthShell, { authPrimaryButtonClass } from "./AuthShell";

/** iOS is a companion for existing accounts; no signup or purchase links. */
export default function ExistingAccountOnly() {
    const nav = useNavigate();
    async function returnToLogin() {
        await supabase.auth.signOut({ scope: "local" });
        nav("/login", { replace: true });
    }
    return (
        <AuthShell title="Mevcut hesabınızla giriş yapın">
            <p className="mb-5 text-sm text-slate-600 dark:text-slate-300">
                PerdePRO iOS uygulaması mevcut işletme hesaplarıyla kullanılır.
                Hesabınızın işletme bağlantısı için firma yöneticinizle görüşün.
            </p>
            <button type="button" className={authPrimaryButtonClass} onClick={returnToLogin}>
                Giriş ekranına dön
            </button>
        </AuthShell>
    );
}
