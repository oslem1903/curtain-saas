import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";

export default function Register() {
    const nav = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [password2, setPassword2] = useState("");
    const [info, setInfo] = useState("");

    useEffect(() => {
        // girişliyse register göstermeyelim
        supabase.auth.getSession().then(({ data }) => {
            if (data.session) nav("/dashboard", { replace: true });
        });
    }, [nav]);

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault();
        setInfo("");

        const cleanEmail = email.trim();
        if (!cleanEmail) return setInfo("E-posta yaz.");
        if (password.length < 6) return setInfo("Şifre en az 6 karakter olmalı.");
        if (password !== password2) return setInfo("Şifreler aynı değil.");

        const emailRedirectTo = `${window.location.origin}/dashboard`;

        const { error } = await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: { emailRedirectTo },
        });

        if (error) return setInfo(error.message);

        // Email confirmation açıksa kullanıcıya bilgi verelim
        setInfo("Kayıt alındı. Mail onayı gerekiyorsa e-postanı kontrol et (spam dahil).");
    }

    return (
        <div style={{ maxWidth: 420, margin: "60px auto", padding: 16 }}>
            <h2>Kayıt Ol</h2>

            <form onSubmit={handleRegister} style={{ display: "grid", gap: 10, marginTop: 12 }}>
                <label>
                    E-posta
                    <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        type="email"
                        placeholder="ornek@mail.com"
                        style={{ width: "100%", padding: 10, marginTop: 6 }}
                    />
                </label>

                <label>
                    Şifre
                    <input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        type="password"
                        placeholder="en az 6 karakter"
                        style={{ width: "100%", padding: 10, marginTop: 6 }}
                    />
                </label>

                <label>
                    Şifre (Tekrar)
                    <input
                        value={password2}
                        onChange={(e) => setPassword2(e.target.value)}
                        type="password"
                        placeholder="tekrar"
                        style={{ width: "100%", padding: 10, marginTop: 6 }}
                    />
                </label>

                <button type="submit" style={{ padding: 10, cursor: "pointer" }}>
                    Kayıt Ol
                </button>

                {info ? <p style={{ marginTop: 6 }}>{info}</p> : null}

                <div style={{ fontSize: 13, opacity: 0.8 }}>
                    Zaten hesabın var mı? <Link to="/login">Giriş Yap</Link>
                </div>
            </form>
        </div>
    );
}