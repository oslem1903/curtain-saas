import { useEffect, useState } from "react";
import { Loader2, Save, Sparkles } from "lucide-react";
import { supabase } from "../supabaseClient";
import { ENTERPRISE_MODULES, PRO_MODULES, SOLO_MODULES } from "../context/AuthContext";

type Settings = {
    enabled: boolean;
    trial_days: number;
    package_code: string;
    max_users: number;
};

const PACKAGE_OPTIONS: Array<{ code: string; label: string; modules: string[] }> = [
    { code: "solo", label: "Solo Perdeci", modules: SOLO_MODULES },
    { code: "pro", label: "Profesyonel", modules: PRO_MODULES },
    { code: "enterprise", label: "Kurumsal", modules: ENTERPRISE_MODULES },
];

/**
 * Süper admin: kodsuz kayıt (7 gün ücretsiz dene) varsayılanları.
 * Yalnızca YENİ kendi kaydını yapan işletmeleri etkiler; mevcut firmalara dokunmaz.
 * Tek bir işletmeye farklı süre/özel hak vermek için aşağıdaki listedeki
 * "süre uzat" ve paket/modül araçları ile Lisans Yönetimi kullanılır.
 */
export default function SelfSignupSettingsCard() {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        let alive = true;
        supabase
            .from("self_signup_settings")
            .select("enabled,trial_days,package_code,max_users")
            .eq("id", 1)
            .maybeSingle()
            .then(({ data, error: loadError }) => {
                if (!alive) return;
                if (loadError) {
                    setError(
                        /self_signup_settings|schema cache|does not exist/i.test(loadError.message || "")
                            ? "Kodsuz kayıt altyapısı kurulmamış. supabase_migration_024_self_service_signup_trial.sql dosyasını çalıştırın."
                            : loadError.message,
                    );
                } else if (data) {
                    setSettings(data as Settings);
                }
                setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, []);

    async function save() {
        if (!settings) return;
        const days = Math.round(Number(settings.trial_days));
        if (!Number.isFinite(days) || days < 1 || days > 90) {
            setError("Deneme süresi 1 ile 90 gün arasında olmalı.");
            return;
        }
        const pkg = PACKAGE_OPTIONS.find((item) => item.code === settings.package_code) ?? PACKAGE_OPTIONS[0];
        setSaving(true);
        setError("");
        setSaved(false);
        const { data: userData } = await supabase.auth.getUser();
        const { error: saveError } = await supabase
            .from("self_signup_settings")
            .update({
                enabled: settings.enabled,
                trial_days: days,
                package_code: pkg.code,
                enabled_modules: pkg.modules,
                max_users: Math.max(1, Math.round(Number(settings.max_users) || 3)),
                updated_at: new Date().toISOString(),
                updated_by: userData.user?.id ?? null,
            })
            .eq("id", 1);
        setSaving(false);
        if (saveError) {
            setError(saveError.message);
            return;
        }
        setSaved(true);
    }

    return (
        <div className="xl:col-span-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black tracking-wider text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <Sparkles className="h-4 w-4" />
                        Kodsuz kayıt
                    </div>
                    <h2 className="mt-3 text-xl font-black text-slate-900 dark:text-white">“7 gün ücretsiz dene” ayarları</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                        Uygulamayı indiren kullanıcının kendi kaydıyla açılan işletmelerine uygulanır. Mevcut firmalar etkilenmez.
                    </p>
                </div>
                {loading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : null}
            </div>

            {settings ? (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
                    <label className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                        <input
                            type="checkbox"
                            checked={settings.enabled}
                            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                            className="h-4 w-4"
                        />
                        Kayıt açık
                    </label>
                    <label className="text-xs font-bold text-slate-500">
                        Deneme (gün)
                        <input
                            type="number"
                            min={1}
                            max={90}
                            value={settings.trial_days}
                            onChange={(e) => setSettings({ ...settings, trial_days: Number(e.target.value) })}
                            className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                    </label>
                    <label className="text-xs font-bold text-slate-500">
                        Paket
                        <select
                            value={settings.package_code}
                            onChange={(e) => setSettings({ ...settings, package_code: e.target.value })}
                            className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                            {PACKAGE_OPTIONS.map((item) => (
                                <option key={item.code} value={item.code}>
                                    {item.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="text-xs font-bold text-slate-500">
                        Kullanıcı limiti
                        <input
                            type="number"
                            min={1}
                            value={settings.max_users}
                            onChange={(e) => setSettings({ ...settings, max_users: Number(e.target.value) })}
                            className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={save}
                        disabled={saving}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-black text-white disabled:opacity-60"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Kaydet
                    </button>
                </div>
            ) : null}

            {error ? <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
            {saved ? <div className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">Kaydedildi. Yeni kayıtlara uygulanır.</div> : null}
        </div>
    );
}
