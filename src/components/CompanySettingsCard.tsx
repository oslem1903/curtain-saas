import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";
import { Upload, X, Check, Loader2 } from "lucide-react";

type CompanySettingsState = {
    id: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    tax_office: string;
    tax_no: string;
    logo_url: string | null;
};

type Message = { type: "success" | "error"; text: string } | null;

export function CompanySettingsCard() {
    const { company, refreshAuth } = useAuth();
    const [settings, setSettings] = useState<CompanySettingsState | null>(null);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState<Message>(null);
    const [isEditing, setIsEditing] = useState(false);

    // Load company data
    useEffect(() => {
        if (!company?.id) return;

        setSettings({
            id: company.id,
            name: company.name || "",
            phone: company.phone || "",
            email: company.email || "",
            address: company.address || "",
            tax_office: company.tax_office || "",
            tax_no: company.tax_no || "",
            logo_url: company.logo_url || null,
        });
    }, [company]);

    // Fetch fresh company data after successful save
    async function refreshCompany() {
        if (!company?.id) return;
        try {
            const { data } = await supabase
                .from("companies")
                .select(
                    "id,name,phone,email,address,tax_office,tax_no,logo_url"
                )
                .eq("id", company.id)
                .maybeSingle();

            if (data) {
                setSettings({
                    id: data.id,
                    name: data.name || "",
                    phone: data.phone || "",
                    email: data.email || "",
                    address: data.address || "",
                    tax_office: data.tax_office || "",
                    tax_no: data.tax_no || "",
                    logo_url: data.logo_url || null,
                });
            }
        } catch {
            // Silently fail, keep current state
        }
    }

    async function handleSave() {
        if (!settings) return;

        setLoading(true);
        setMessage(null);

        try {
            const { data, error } = await supabase.rpc(
                "update_company_profile",
                {
                    p_company_id: settings.id,
                    p_name: settings.name || null,
                    p_phone: settings.phone || null,
                    p_email: settings.email || null,
                    p_address: settings.address || null,
                    p_tax_office: settings.tax_office || null,
                    p_tax_no: settings.tax_no || null,
                }
            );

            if (error) throw error;

            if (data?.success) {
                setMessage({ type: "success", text: data.message });
                setIsEditing(false);
                await refreshCompany();
                await refreshAuth();
            } else {
                setMessage({ type: "error", text: data?.message || "Bir hata oluştu." });
            }
        } catch (err) {
            setMessage({
                type: "error",
                text:
                    err instanceof Error
                        ? err.message
                        : "Şirket profili kaydedilemedi.",
            });
        } finally {
            setLoading(false);
        }
    }

    function fileToResizedDataUrl(
        file: File,
        maxSize = 512
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const scale = Math.min(
                        1,
                        maxSize / Math.max(img.width, img.height)
                    );
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.round(img.width * scale);
                    canvas.height = Math.round(img.height * scale);
                    const ctx = canvas.getContext("2d");
                    if (!ctx) {
                        reject(new Error("canvas yok"));
                        return;
                    }
                    ctx.drawImage(
                        img,
                        0,
                        0,
                        canvas.width,
                        canvas.height
                    );
                    resolve(canvas.toDataURL("image/png"));
                };
                img.onerror = () => reject(new Error("görsel okunamadı"));
                img.src = String(reader.result);
            };
            reader.onerror = () => reject(new Error("dosya okunamadı"));
            reader.readAsDataURL(file);
        });
    }

    async function handleLogoUpload(
        e: React.ChangeEvent<HTMLInputElement>
    ) {
        try {
            setUploading(true);
            setMessage(null);

            if (!e.target.files || e.target.files.length === 0) return;
            const file = e.target.files[0];

            if (file.size > 5 * 1024 * 1024) {
                setMessage({
                    type: "error",
                    text: "Dosya çok büyük. Lütfen 5MB altında bir görsel seçin.",
                });
                return;
            }

            let logoValue: string | null = null;

            // Try Supabase Storage first
            try {
                const fileExt = file.name.split(".").pop();
                const filePath = `${settings?.id}-logo.${fileExt}`;
                const { error: uploadError } = await supabase.storage
                    .from("logos")
                    .upload(filePath, file, { upsert: true });

                if (!uploadError) {
                    const { data } =
                        supabase.storage.from("logos").getPublicUrl(filePath);
                    logoValue = `${data.publicUrl}?v=${Date.now()}`;
                }
            } catch {
                // Storage unavailable, fall back to base64
            }

            // Fallback to resized base64
            if (!logoValue) {
                logoValue = await fileToResizedDataUrl(file);
            }

            const { error: updateError } = await supabase
                .from("companies")
                .update({ logo_url: logoValue })
                .eq("id", settings?.id);

            if (updateError) throw updateError;

            setSettings((prev) =>
                prev ? { ...prev, logo_url: logoValue } : null
            );
            setMessage({ type: "success", text: "Logo başarıyla güncellendi." });
        } catch {
            setMessage({
                type: "error",
                text: "Logo kaydedilemedi. Lütfen farklı bir görselle tekrar deneyin.",
            });
        } finally {
            setUploading(false);
        }
    }

    async function handleRemoveLogo() {
        try {
            setUploading(true);
            const { error } = await supabase
                .from("companies")
                .update({ logo_url: null })
                .eq("id", settings?.id);

            if (error) throw error;
            setSettings((prev) =>
                prev ? { ...prev, logo_url: null } : null
            );
            setMessage({ type: "success", text: "Logo kaldırıldı." });
        } catch {
            setMessage({
                type: "error",
                text: "Logo kaldırılamadı. Lütfen tekrar deneyin.",
            });
        } finally {
            setUploading(false);
        }
    }

    if (!settings) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 sm:p-8">
                <div className="animate-pulse space-y-4">
                    <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded w-1/3"></div>
                    <div className="h-12 bg-slate-200 dark:bg-slate-800 rounded"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            {/* Logo Section */}
            <div className="border-b border-slate-100 dark:border-slate-800 p-6 sm:p-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex-1">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                            Kurumsal Logo
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            Sistem genelinde ve raporlarda görünecek şirket
                            logonuzu yükleyin.
                        </p>
                    </div>

                    <div className="flex flex-col items-center gap-4">
                        <div className="relative group">
                            <div className="w-32 h-32 rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden transition-all group-hover:border-primary-400">
                                {settings.logo_url ? (
                                    <img
                                        src={settings.logo_url}
                                        alt="Company Logo"
                                        className="w-full h-full object-contain p-2"
                                    />
                                ) : (
                                    <Upload className="w-8 h-8 text-slate-400" />
                                )}
                                {uploading && (
                                    <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 flex items-center justify-center backdrop-blur-sm">
                                        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
                                    </div>
                                )}
                            </div>

                            {settings.logo_url && !uploading && (
                                <button
                                    onClick={handleRemoveLogo}
                                    className="absolute -top-2 -right-2 p-1.5 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors shadow-sm"
                                    title="Logoyu Kaldır"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>

                        <label className="relative cursor-pointer bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm flex items-center gap-2">
                            <Upload className="w-4 h-4" />
                            {settings.logo_url ? "Logoyu Değiştir" : "Logo Yükle"}
                            <input
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={handleLogoUpload}
                                disabled={uploading}
                            />
                        </label>
                        <p className="text-[11px] text-slate-400">
                            PNG, JPG veya SVG (Önerilen: Kare, max 2MB)
                        </p>
                    </div>
                </div>
            </div>

            {/* Profile Settings Section */}
            <div className="p-6 sm:p-8">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                            Şirket Profili
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            Kurumsal bilgilerinizi güncelleyin.
                        </p>
                    </div>
                    {!isEditing && (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="text-primary-600 hover:text-primary-700 font-medium text-sm"
                        >
                            Düzenle
                        </button>
                    )}
                </div>

                {message && (
                    <div
                        className={`p-4 rounded-xl flex items-center gap-3 mb-6 ${
                            message.type === "success"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200"
                                : "bg-red-50 text-red-700 border border-red-100 dark:bg-red-950/30 dark:text-red-200"
                        }`}
                    >
                        {message.type === "success" ? (
                            <Check className="w-5 h-5 flex-shrink-0" />
                        ) : (
                            <X className="w-5 h-5 flex-shrink-0" />
                        )}
                        <span className="text-sm font-medium">{message.text}</span>
                    </div>
                )}

                {isEditing ? (
                    <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            {/* Company Name */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                                    Şirket Adı
                                </label>
                                <input
                                    type="text"
                                    value={settings.name}
                                    onChange={(e) =>
                                        setSettings({
                                            ...settings,
                                            name: e.target.value,
                                        })
                                    }
                                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm outline-none focus:border-primary-400 dark:text-white"
                                />
                            </div>

                            {/* Phone */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                                    Telefon
                                </label>
                                <input
                                    type="tel"
                                    value={settings.phone}
                                    onChange={(e) =>
                                        setSettings({
                                            ...settings,
                                            phone: e.target.value,
                                        })
                                    }
                                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm outline-none focus:border-primary-400 dark:text-white"
                                />
                            </div>

                            {/* Email */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                                    E-posta
                                </label>
                                <input
                                    type="email"
                                    value={settings.email}
                                    onChange={(e) =>
                                        setSettings({
                                            ...settings,
                                            email: e.target.value,
                                        })
                                    }
                                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm outline-none focus:border-primary-400 dark:text-white"
                                />
                            </div>

                            {/* Tax Number */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                                    Vergi Numarası
                                </label>
                                <input
                                    type="text"
                                    value={settings.tax_no}
                                    onChange={(e) =>
                                        setSettings({
                                            ...settings,
                                            tax_no: e.target.value,
                                        })
                                    }
                                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm outline-none focus:border-primary-400 dark:text-white"
                                />
                            </div>

                            {/* Tax Office */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                                    Vergi Dairesi
                                </label>
                                <input
                                    type="text"
                                    value={settings.tax_office}
                                    onChange={(e) =>
                                        setSettings({
                                            ...settings,
                                            tax_office: e.target.value,
                                        })
                                    }
                                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm outline-none focus:border-primary-400 dark:text-white"
                                />
                            </div>
                        </div>

                        {/* Address - Full Width */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                                Adres
                            </label>
                            <textarea
                                value={settings.address}
                                onChange={(e) =>
                                    setSettings({
                                        ...settings,
                                        address: e.target.value,
                                    })
                                }
                                rows={3}
                                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm outline-none focus:border-primary-400 dark:text-white resize-none"
                            />
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3 pt-4">
                            <button
                                onClick={handleSave}
                                disabled={loading}
                                className="flex-1 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white px-6 py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Kaydediliyor...
                                    </>
                                ) : (
                                    <>
                                        <Check className="w-4 h-4" />
                                        Kaydet
                                    </>
                                )}
                            </button>
                            <button
                                onClick={() => setIsEditing(false)}
                                disabled={loading}
                                className="flex-1 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-300 px-6 py-3 rounded-lg text-sm font-medium transition-all"
                            >
                                İptal
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                        {/* Display Mode */}
                        <div>
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">
                                Şirket Adı
                            </p>
                            <p className="text-slate-900 dark:text-white">
                                {settings.name || "—"}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">
                                Telefon
                            </p>
                            <p className="text-slate-900 dark:text-white">
                                {settings.phone || "—"}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">
                                E-posta
                            </p>
                            <p className="text-slate-900 dark:text-white">
                                {settings.email || "—"}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">
                                Vergi Numarası
                            </p>
                            <p className="text-slate-900 dark:text-white">
                                {settings.tax_no || "—"}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">
                                Vergi Dairesi
                            </p>
                            <p className="text-slate-900 dark:text-white">
                                {settings.tax_office || "—"}
                            </p>
                        </div>
                        <div className="md:col-span-2">
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">
                                Adres
                            </p>
                            <p className="text-slate-900 dark:text-white whitespace-pre-wrap">
                                {settings.address || "—"}
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
