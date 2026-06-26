import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../supabaseClient";

function getRecoveryParams() {
    const hash = window.location.hash || "";
    const query = window.location.search || "";
    const paramText = [
        query.startsWith("?") ? query.slice(1) : query,
        ...hash.split("#").slice(1),
        hash.includes("?") ? hash.split("?").slice(1).join("?") : "",
    ]
        .filter(Boolean)
        .join("&");

    return new URLSearchParams(paramText);
}

export default function ResetPassword() {
    const [password, setPassword] = useState("");
    const [password2, setPassword2] = useState("");
    const [status, setStatus] = useState("Sifre sifirlama baglantisi kontrol ediliyor...");
    const [ready, setReady] = useState(false);
    const [loading, setLoading] = useState(false);

    const canSubmit = useMemo(() => ready && !loading, [loading, ready]);

    useEffect(() => {
        let alive = true;

        async function prepareRecoverySession() {
            setReady(false);
            const params = getRecoveryParams();
            const accessToken = params.get("access_token");
            const refreshToken = params.get("refresh_token");
            const code = params.get("code");

            try {
                if (accessToken && refreshToken) {
                    const { error } = await supabase.auth.setSession({
                        access_token: accessToken,
                        refresh_token: refreshToken,
                    });
                    if (error) throw error;
                } else if (code) {
                    const { error } = await supabase.auth.exchangeCodeForSession(code);
                    if (error) throw error;
                }

                const { data, error } = await supabase.auth.getSession();
                if (error) throw error;
                if (!alive) return;

                if (!data.session) {
                    setStatus("Sifre sifirlama oturumu bulunamadi. Maildeki son sifirlama linkini tekrar acin.");
                    setReady(false);
                    return;
                }

                window.history.replaceState(null, document.title, `${window.location.pathname}#/reset-password`);
                setStatus("Yeni sifrenizi girin.");
                setReady(true);
            } catch (error: any) {
                if (!alive) return;
                setStatus(error?.message || "Sifre sifirlama baglantisi dogrulanamadi.");
                setReady(false);
            }
        }

        void prepareRecoverySession();

        return () => {
            alive = false;
        };
    }, []);

    async function handleUpdate() {
        if (!canSubmit) return;
        if (password.length < 6) return setStatus("Sifre en az 6 karakter olmali.");
        if (password !== password2) return setStatus("Sifreler ayni degil.");

        setLoading(true);
        const { error } = await supabase.auth.updateUser({ password });
        setLoading(false);

        if (error) return setStatus(error.message);

        await supabase.auth.signOut();
        setPassword("");
        setPassword2("");
        setReady(false);
        setStatus("Sifre guncellendi. Simdi yeni sifrenizle giris yapabilirsiniz.");
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
                <h2 className="text-2xl font-black text-slate-900 dark:text-white">Sifre Sifirlama</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{status}</p>

                <div className="mt-6 space-y-3">
                    <input
                        type="password"
                        placeholder="Yeni sifre"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={!ready || loading}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <input
                        type="password"
                        placeholder="Yeni sifre tekrar"
                        value={password2}
                        onChange={(e) => setPassword2(e.target.value)}
                        disabled={!ready || loading}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                </div>

                <button
                    onClick={handleUpdate}
                    disabled={!canSubmit}
                    className="mt-5 w-full rounded-xl bg-primary-600 px-4 py-3 font-bold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {loading ? "Guncelleniyor..." : "Sifreyi Guncelle"}
                </button>

                <Link to="/login" className="mt-4 block text-center text-sm font-bold text-primary-700 dark:text-primary-300">
                    Giris ekranina don
                </Link>
            </div>
        </div>
    );
}
