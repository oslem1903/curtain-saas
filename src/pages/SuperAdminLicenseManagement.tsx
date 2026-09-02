import { useEffect, useState } from "react";
import { Lock, Calendar, Users, HardDrive } from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { supabase } from "../supabaseClient";

type Company = {
    id: string;
    name: string;
    subscription_plan: string;
    subscription_status: string;
    trial_ends_at: string | null;
    license_expires_at: string | null;
    max_users: number | null;
    max_devices: number | null;
    payment_reference: string | null;
    billing_note: string | null;
    created_at?: string | null;
};

export default function SuperAdminLicenseManagement() {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState<string | null>(null);
    const [editValues, setEditValues] = useState({
        max_users: 0,
        max_devices: 0,
        trial_days: 0,
        subscription_status: "trial",
        subscription_plan: "solo",
        license_expires_at: "",
        payment_reference: "",
        billing_note: "",
    });

    useEffect(() => {
        loadCompanies();
    }, []);

    async function loadCompanies() {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("companies")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(100);

            if (error) throw error;
            setCompanies(data || []);
        } catch (e: any) {
            alert("Firmalar yüklenirken hata: " + (e?.message || "Bilinmeyen hata"));
        } finally {
            setLoading(false);
        }
    }

    async function updateLicense(companyId: string) {
        try {
            // Update subscription and license info via RPC
            const { error: rpcError } = await supabase.rpc("super_admin_update_company_license", {
                p_company_id: companyId,
                p_subscription_status: editValues.subscription_status,
                p_subscription_plan: editValues.subscription_plan || null,
                p_license_expires_at: editValues.license_expires_at ? new Date(editValues.license_expires_at).toISOString() : null,
                p_payment_reference: editValues.payment_reference || null,
                p_billing_note: editValues.billing_note || null,
            });

            if (rpcError) throw rpcError;

            // Update device/user limits directly
            const { error: limitError } = await supabase
                .from("companies")
                .update({
                    max_users: editValues.max_users || null,
                    max_devices: editValues.max_devices || null,
                })
                .eq("id", companyId);

            if (limitError) throw limitError;

            // If trial days specified, extend trial
            if (editValues.trial_days > 0) {
                await supabase.rpc("extend_company_trial", {
                    p_company_id: companyId,
                    p_extra_days: editValues.trial_days,
                });
            }

            alert("✓ Lisans güncellendi");
            setEditing(null);
            await loadCompanies();
        } catch (e: any) {
            alert("Güncelleme hatası: " + (e?.message || "Bilinmeyen hata"));
        }
    }

    const filteredCompanies = companies.filter(
        (c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.subscription_plan.includes(search)
    );

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                            <Lock size={20} className="text-purple-600" />
                        </div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white">Lisans Yönetimi</h1>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">
                        Firma lisanslarını ve limitlerini yönet
                    </p>
                </div>

                {/* Search */}
                <div className="mb-6">
                    <input
                        type="text"
                        placeholder="Firma adında ara..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
                    />
                </div>

                {/* Companies List */}
                <div className="space-y-3">
                    {loading ? (
                        <div className="text-center py-12 text-slate-500">Yükleniyor...</div>
                    ) : filteredCompanies.length === 0 ? (
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
                            <p className="text-slate-600 dark:text-slate-400">Firma bulunamadı</p>
                        </div>
                    ) : (
                        filteredCompanies.map((company) => (
                            <div
                                key={company.id}
                                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6"
                            >
                                <div className="flex items-start justify-between gap-4 mb-4 pb-4 border-b border-slate-200 dark:border-slate-700">
                                    <div>
                                        <h3 className="text-lg font-black text-slate-900 dark:text-white">
                                            {company.name}
                                        </h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            Paket: {company.subscription_plan} • Status: {company.subscription_status}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setEditing(company.id);
                                            setEditValues({
                                                max_users: company.max_users || 0,
                                                max_devices: company.max_devices || 0,
                                                trial_days: 0,
                                                subscription_status: company.subscription_status || "trial",
                                                subscription_plan: company.subscription_plan || "solo",
                                                license_expires_at: company.license_expires_at || "",
                                                payment_reference: company.payment_reference || "",
                                                billing_note: company.billing_note || "",
                                            });
                                        }}
                                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700"
                                    >
                                        Düzenle
                                    </button>
                                </div>

                                {editing === company.id ? (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <div>
                                                <label className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase">
                                                    Subscription Status
                                                </label>
                                                <select
                                                    value={editValues.subscription_status}
                                                    onChange={(e) =>
                                                        setEditValues({ ...editValues, subscription_status: e.target.value })
                                                    }
                                                    className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                                                >
                                                    <option value="trial">Trial</option>
                                                    <option value="active">Active</option>
                                                    <option value="suspended">Suspended</option>
                                                    <option value="expired">Expired</option>
                                                    <option value="cancelled">Cancelled</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase">
                                                    <Calendar size={16} className="inline mr-1" />
                                                    Paket
                                                </label>
                                                <select
                                                    value={editValues.subscription_plan}
                                                    onChange={(e) =>
                                                        setEditValues({ ...editValues, subscription_plan: e.target.value })
                                                    }
                                                    className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                                                >
                                                    <option value="starter">Başlangıç</option>
                                                    <option value="solo">Solo</option>
                                                    <option value="pro">Pro</option>
                                                    <option value="enterprise">Enterprise</option>
                                                    <option value="lifetime">Lifetime</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <div>
                                                <label className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase">
                                                    <Calendar size={16} className="inline mr-1" />
                                                    License Bitiş Tarihi
                                                </label>
                                                <input
                                                    type="date"
                                                    value={editValues.license_expires_at.split("T")[0] || ""}
                                                    onChange={(e) =>
                                                        setEditValues({ ...editValues, license_expires_at: e.target.value })
                                                    }
                                                    className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase">
                                                    Ödeme Referansı
                                                </label>
                                                <input
                                                    type="text"
                                                    value={editValues.payment_reference}
                                                    onChange={(e) =>
                                                        setEditValues({ ...editValues, payment_reference: e.target.value })
                                                    }
                                                    placeholder="e.g., INV-2026-001"
                                                    className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <div>
                                                <label className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase">
                                                    <Users size={16} className="inline mr-1" />
                                                    Max Kullanıcı
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={editValues.max_users}
                                                    onChange={(e) =>
                                                        setEditValues({ ...editValues, max_users: parseInt(e.target.value) || 0 })
                                                    }
                                                    className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase">
                                                    <HardDrive size={16} className="inline mr-1" />
                                                    Max Cihaz
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={editValues.max_devices}
                                                    onChange={(e) =>
                                                        setEditValues({ ...editValues, max_devices: parseInt(e.target.value) || 0 })
                                                    }
                                                    className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase">
                                                <Calendar size={16} className="inline mr-1" />
                                                Trial Gün Ekle (Opsiyonel)
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={editValues.trial_days}
                                                onChange={(e) =>
                                                    setEditValues({ ...editValues, trial_days: parseInt(e.target.value) || 0 })
                                                }
                                                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase">
                                                Muhasebe Notu
                                            </label>
                                            <textarea
                                                value={editValues.billing_note}
                                                onChange={(e) =>
                                                    setEditValues({ ...editValues, billing_note: e.target.value })
                                                }
                                                placeholder="İç notlar ve referanslar..."
                                                rows={2}
                                                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => updateLicense(company.id)}
                                                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700"
                                            >
                                                Kaydet
                                            </button>
                                            <button
                                                onClick={() => setEditing(null)}
                                                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-black hover:bg-slate-50 dark:hover:bg-slate-800"
                                            >
                                                İptal
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                                            <p className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase mb-1">
                                                Status
                                            </p>
                                            <p className="text-sm font-black text-slate-900 dark:text-white">
                                                {company.subscription_status || "trial"}
                                            </p>
                                        </div>
                                        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                                            <p className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase mb-1">
                                                Trial Bitiş
                                            </p>
                                            <p className="text-sm font-medium text-slate-900 dark:text-white">
                                                {company.trial_ends_at
                                                    ? format(new Date(company.trial_ends_at), "d MMM yyyy", { locale: tr })
                                                    : "-"}
                                            </p>
                                        </div>
                                        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                                            <p className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase mb-1">
                                                License Bitiş
                                            </p>
                                            <p className="text-sm font-medium text-slate-900 dark:text-white">
                                                {company.license_expires_at
                                                    ? format(new Date(company.license_expires_at), "d MMM yyyy", { locale: tr })
                                                    : "-"}
                                            </p>
                                        </div>
                                        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                                            <p className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase mb-1">
                                                Referans
                                            </p>
                                            <p className="text-sm font-medium text-slate-900 dark:text-white">
                                                {company.payment_reference || "-"}
                                            </p>
                                        </div>
                                        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                                            <p className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase mb-1">
                                                Max Kullanıcı
                                            </p>
                                            <p className="text-lg font-black text-slate-900 dark:text-white">
                                                {company.max_users || "∞"}
                                            </p>
                                        </div>
                                        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                                            <p className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase mb-1">
                                                Max Cihaz
                                            </p>
                                            <p className="text-lg font-black text-slate-900 dark:text-white">
                                                {company.max_devices || "∞"}
                                            </p>
                                        </div>
                                        {company.billing_note && (
                                            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 p-3 lg:col-span-2">
                                                <p className="text-xs font-black text-blue-600 dark:text-blue-400 uppercase mb-1">
                                                    Muhasebe Notu
                                                </p>
                                                <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                                    {company.billing_note}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
