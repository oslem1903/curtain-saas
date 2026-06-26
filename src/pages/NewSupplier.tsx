import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getEffectiveTenantContext, supabase } from "../supabaseClient";

async function getContext() {
    return getEffectiveTenantContext();
}

export default function NewSupplier() {
    const nav = useNavigate();

    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [address, setAddress] = useState("");
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState("");

    async function saveSupplier() {
        try {
            setSaving(true);
            setErr("");

            const ctx = await getContext();

            const { error } = await supabase.from("suppliers").insert({
                company_id: ctx.company_id,
                name,
                phone,
                email,
                address,
            });

            if (error) throw error;

            nav("/suppliers");
        } catch (e: any) {
            setErr(e?.message ?? "Tedarikçi kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                    Yeni Tedarikçi
                </h1>
                <p className="text-slate-500 dark:text-slate-400 mt-1">
                    Tedarikçi bilgilerini girin.
                </p>
            </div>

            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                {err ? (
                    <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200">
                        {err}
                    </div>
                ) : null}

                <div>
                    <label className="block text-sm font-medium mb-1">Firma Adı</label>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                        placeholder="Örn: ABC Tekstil"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">Telefon</label>
                    <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                        placeholder="05xx xxx xx xx"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">E-posta</label>
                    <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                        placeholder="ornek@mail.com"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">Adres</label>
                    <textarea
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950"
                        placeholder="Adres bilgisi"
                        rows={4}
                    />
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={saveSupplier}
                        disabled={saving || !name.trim()}
                        className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium"
                    >
                        {saving ? "Kaydediliyor..." : "Kaydet"}
                    </button>

                    <button
                        onClick={() => nav("/suppliers")}
                        className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium"
                    >
                        Vazgeç
                    </button>
                </div>
            </div>
        </div>
    );
}
