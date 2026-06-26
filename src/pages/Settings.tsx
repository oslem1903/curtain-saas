import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { Upload, X, Check, Loader2 } from "lucide-react";
import { normalizeRole, type RoleState } from "../auth/roles";

export const Settings = () => {
    const navigate = useNavigate();
    const [role, setRole] = useState<RoleState>("unknown");
    const [companyId, setCompanyId] = useState<string | null>(null);
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        async function loadProfile() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: profile } = await supabase
                .from("profiles")
                .select("role")
                .eq("user_id", user.id)
                .maybeSingle();
            
            setRole(normalizeRole(profile?.role));

            const { data: member } = await supabase
                .from("company_members")
                .select("company_id")
                .eq("user_id", user.id)
                .maybeSingle();

            if (member?.company_id) {
                setCompanyId(member.company_id);
                const { data: company } = await supabase
                    .from("companies")
                    .select("logo_url")
                    .eq("id", member.company_id)
                    .maybeSingle();
                
                setLogoUrl(company?.logo_url || null);
            }
        }
        loadProfile();
    }, []);

    async function handleLogout() {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        window.location.reload();
    }

    async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
        try {
            setUploading(true);
            setMessage(null);

            if (!e.target.files || e.target.files.length === 0) return;
            const file = e.target.files[0];
            const fileExt = file.name.split('.').pop();
            const fileName = `${companyId}-${Math.random()}.${fileExt}`;
            const filePath = `${fileName}`;

            // 1. Upload to Storage
            const { error: uploadError } = await supabase.storage
                .from('logos')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // 2. Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('logos')
                .getPublicUrl(filePath);

            // 3. Update Company Table
            const { error: updateError } = await supabase
                .from('companies')
                .update({ logo_url: publicUrl })
                .eq('id', companyId);

            if (updateError) throw updateError;

            setLogoUrl(publicUrl);
            setMessage({ type: 'success', text: 'Logo başarıyla güncellendi.' });
            
            // Layout'daki logoyu da güncellemek için sayfayı yenileyebiliriz veya bir event tetikleyebiliriz.
            // Şimdilik basitlik adına window.location.reload() kullanabiliriz ya da sadece state'i güncelleriz.
            // Layout logoyu DB'den çektiği için bir sonraki render'da (veya manuel refresh'de) güncellenecektir.
        } catch (error: any) {
            setMessage({ type: 'error', text: 'Logo yüklenirken hata oluştu: ' + error.message });
        } finally {
            setUploading(false);
        }
    }

    async function handleRemoveLogo() {
        try {
            setUploading(true);
            const { error } = await supabase
                .from('companies')
                .update({ logo_url: null })
                .eq('id', companyId);

            if (error) throw error;
            setLogoUrl(null);
            setMessage({ type: 'success', text: 'Logo kaldırıldı.' });
        } catch (error: any) {
            setMessage({ type: 'error', text: 'Hata: ' + error.message });
        } finally {
            setUploading(false);
        }
    }

    const isAdmin = role === "admin";

    return (
        <div className="mx-auto max-w-4xl space-y-6 pb-24">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Ayarlar</h1>
                <p className="text-slate-500 dark:text-slate-400 mt-1">Uygulama tercihlerinizi ve kurumsal kimliğinizi yönetin.</p>
            </div>

            {message && (
                <div className={`p-4 rounded-xl flex items-center gap-3 ${
                    message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'
                }`}>
                    {message.type === 'success' ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
                    <span className="text-sm font-medium">{message.text}</span>
                </div>
            )}

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                
                {/* LOGO AYARLARI (Sadece Admin) */}
                {isAdmin && (
                    <div className="border-b border-slate-100 p-6 dark:border-slate-800 sm:p-8">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Kurumsal Logo</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                    Sistem genelinde ve raporlarda görünecek şirket logonuzu yükleyin.
                                </p>
                            </div>
                            
                            <div className="flex flex-col items-center gap-4">
                                <div className="relative group">
                                    <div className="w-32 h-32 rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden transition-all group-hover:border-primary-400">
                                        {logoUrl ? (
                                            <img src={logoUrl} alt="Company Logo" className="w-full h-full object-contain p-2" />
                                        ) : (
                                            <Upload className="w-8 h-8 text-slate-400" />
                                        )}
                                        {uploading && (
                                            <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 flex items-center justify-center backdrop-blur-sm">
                                                <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
                                            </div>
                                        )}
                                    </div>
                                    
                                    {logoUrl && !uploading && (
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
                                    {logoUrl ? 'Logoyu Değiştir' : 'Logo Yükle'}
                                    <input 
                                        type="file" 
                                        className="hidden" 
                                        accept="image/*" 
                                        onChange={handleLogoUpload} 
                                        disabled={uploading}
                                    />
                                </label>
                                <p className="text-[11px] text-slate-400">PNG, JPG veya SVG (Önerilen: Kare, max 2MB)</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* PROFIL */}
                <div className="border-b border-slate-100 p-6 dark:border-slate-800 sm:p-8">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Profil Ayarları</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Kişisel bilgilerinizi ve şifrenizi güncelleyin.</p>
                    <div className="mt-6 flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-700 dark:text-primary-300 font-bold text-xl">
                            {role ? role.charAt(0).toUpperCase() : '?'}
                        </div>
                        <div>
                            <p className="font-medium text-slate-900 dark:text-white">Oturum Açan Rol</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">{role || 'Yükleniyor...'}</p>
                        </div>
                    </div>
                </div>

                {/* GORUNUM */}
                <div className="border-b border-slate-100 p-6 dark:border-slate-800 sm:p-8">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Görünüm</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Koyu mod/Açık mod tercihlerinizi belirleyin.</p>
                    <div className="mt-4 flex gap-4">
                         <div className="flex-1 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-center text-sm text-slate-500">
                            Sistem teması otomatik algılanmaktadır.
                         </div>
                    </div>
                </div>

                {/* CIKIS */}
                <div className="bg-slate-50/50 p-6 dark:bg-slate-800/20 sm:p-8">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h3 className="text-lg font-semibold text-red-600">Oturumu Kapat</h3>
                            <p className="text-sm text-slate-500 mt-1">Mevcut oturumu güvenli bir şekilde sonlandırın.</p>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="w-full rounded-xl bg-white border border-red-200 px-6 py-3 text-red-600 hover:bg-red-50 font-medium transition-all shadow-sm sm:w-auto sm:py-2.5"
                        >
                            Çıkış Yap
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};
