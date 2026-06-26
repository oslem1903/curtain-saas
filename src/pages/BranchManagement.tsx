import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { Building2, Plus, Loader2, RefreshCw, Briefcase, Wallet, Calendar, ShieldCheck } from "lucide-react";

type BranchStat = {
    company_id: string;
    name: string;
    total_sales: number;
    total_collection: number;
    total_expense: number;
    is_branch: boolean;
    created_at: string;
};

export default function BranchManagement() {
    const [stats, setStats] = useState<BranchStat[]>([]);
    const [loading, setLoading] = useState(true);
    const [companyId, setCompanyId] = useState<string | null>(null);

    // Form
    const [showAddModal, setShowAddModal] = useState(false);
    const [branchName, setBranchName] = useState("");
    const [branchCode, setBranchCode] = useState("");
    const [inviteCode, setInviteCode] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: cm } = await supabase
                .from("company_members")
                .select("company_id")
                .eq("user_id", user.id)
                .maybeSingle();

            if (!cm?.company_id) return;
            setCompanyId(cm.company_id);

            const { data: branchStats, error } = await supabase.rpc("get_branch_stats", { p_parent_id: cm.company_id });
            if (error) {
                console.error(error);
                // Eğer RPC henüz yüklenmediyse sessizce geç.
            } else {
                setStats(branchStats || []);
            }
        } catch (e: any) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleAddBranch() {
        if (!branchName || !inviteCode || !companyId) {
            alert("Lütfen zorunlu alanları doldurun.");
            return;
        }
        setSaving(true);
        try {
            const { error } = await supabase.rpc("create_branch", {
                p_parent_id: companyId,
                p_name: branchName,
                p_code: branchCode || branchName.substring(0, 3).toUpperCase(),
                p_invite_code: inviteCode
            });

            if (error) throw error;

            setShowAddModal(false);
            setBranchName("");
            setBranchCode("");
            setInviteCode("");
            await loadData();
            alert("Şube başarıyla oluşturuldu! ✅\n\nŞube Yönetiçinize verdiğiniz Davet Kodu ile giriş yapmasını söyleyebilirsiniz.");
        } catch (e: any) {
            alert("Hata (Lütfen Veritabanı SQL betiğini çalıştırdığınızdan emin olun): " + e.message);
        } finally {
            setSaving(false);
        }
    }

    const formatTL = (val: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(val);

    const totalSales = stats.reduce((acc, s) => acc + Number(s.total_sales), 0);
    const totalCollection = stats.reduce((acc, s) => acc + Number(s.total_collection), 0);
    const totalExpense = stats.reduce((acc, s) => acc + Number(s.total_expense), 0);

    return (
        <div className="p-4 sm:p-6 max-w-7xl mx-auto animate-in fade-in duration-500 pb-24">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-200">
                        <Building2 className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Şubeler & Master Rapor</h1>
                        <p className="text-slate-500 text-sm">Alt şubelerinizi oluşturun ve konsolide (genel) raporlarınızı takip edin.</p>
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-3">
                    <button onClick={loadData} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm hover:bg-slate-50 transition" title="Yenile">
                        <RefreshCw className={`w-5 h-5 text-slate-600 ${loading ? "animate-spin" : ""}`} />
                    </button>
                    <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95 w-full sm:w-auto">
                        <Plus className="w-5 h-5" />
                        Yeni Şube Ekle
                    </button>
                </div>
            </div>

            {/* MASTER STATS */}
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-4">Konsolide (Tüm Şubeler) Bilanço</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8">
                <div className="p-6 bg-emerald-50 dark:bg-emerald-900/10 rounded-3xl border border-emerald-100 dark:border-emerald-800 shadow-sm">
                    <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400 text-sm mb-2 font-bold">
                        <Wallet className="w-4 h-4" /> Toplam Konsolide Satış
                    </div>
                    <div className="text-2xl sm:text-3xl font-black text-emerald-700 dark:text-emerald-400">
                        {formatTL(totalSales)}
                    </div>
                </div>
                <div className="p-6 bg-blue-50 dark:bg-blue-900/10 rounded-3xl border border-blue-100 dark:border-blue-800 shadow-sm">
                    <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400 text-sm mb-2 font-bold">
                        <Briefcase className="w-4 h-4" /> Toplam Tahsilat
                    </div>
                    <div className="text-2xl sm:text-3xl font-black text-blue-700 dark:text-blue-400">
                        {formatTL(totalCollection)}
                    </div>
                </div>
                <div className="p-6 bg-rose-50 dark:bg-rose-900/10 rounded-3xl border border-rose-100 dark:border-rose-800 shadow-sm">
                    <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400 text-sm mb-2 font-bold">
                        <Calendar className="w-4 h-4" /> Toplam Gider
                    </div>
                    <div className="text-2xl sm:text-3xl font-black text-rose-700 dark:text-rose-400">
                        {formatTL(totalExpense)}
                    </div>
                </div>
            </div>

            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-4">Şube Bazlı Durum</h2>
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-xl overflow-hidden">
                {loading ? (
                    <div className="p-20 text-center"><Loader2 className="w-10 h-10 animate-spin mx-auto text-indigo-600 mb-4" /></div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                                <tr>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Firma / Şube Adı</th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Türü</th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Toplam Satış</th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Tahsilat</th>
                                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Gider</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {stats.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="p-6 text-center text-slate-500">Henüz şube verisi bulunamadı veya SQL modülü çalıştırılmadı.</td>
                                    </tr>
                                )}
                                {stats.map(s => (
                                    <tr key={s.company_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                        <td className="px-6 py-4 font-bold text-slate-900 dark:text-white uppercase">
                                            {s.name}
                                        </td>
                                        <td className="px-6 py-4">
                                            {s.is_branch ? (
                                                <span className="px-3 py-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-lg text-xs font-bold">Şube</span>
                                            ) : (
                                                <span className="px-3 py-1 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold">Merkez (Ana Firma)</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right font-black text-emerald-600">{formatTL(Number(s.total_sales))}</td>
                                        <td className="px-6 py-4 text-right font-bold text-blue-600">{formatTL(Number(s.total_collection))}</td>
                                        <td className="px-6 py-4 text-right font-bold text-rose-600">{formatTL(Number(s.total_expense))}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in duration-300">
                        <div className="p-8">
                            <h3 className="text-2xl font-bold mb-6">Yeni Şube Ekle</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase ml-1 mb-1 block">Şube Adı *</label>
                                    <input className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none focus:ring-2 focus:ring-indigo-500 font-bold" 
                                        placeholder="Örn: Kadıköy Şubesi" value={branchName} onChange={e => setBranchName(e.target.value)} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1 mb-1 block">Şube Kodu</label>
                                        <input className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none focus:ring-2 focus:ring-indigo-500 font-mono" 
                                            placeholder="KDKY" value={branchCode} onChange={e => setBranchCode(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1 mb-1 block">Yönetici Davet Kodu *</label>
                                        <input className="w-full px-5 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none focus:ring-2 focus:ring-indigo-500 font-mono tracking-widest text-indigo-600" 
                                            placeholder="KDKY-YON" value={inviteCode} onChange={e => setInviteCode(e.target.value)} />
                                    </div>
                                </div>
                                <div className="p-4 bg-indigo-50 rounded-2xl text-sm text-indigo-800 mt-2 border border-indigo-100">
                                    <ShieldCheck className="w-5 h-5 inline-block mr-2 -mt-0.5" />
                                    Şube oluşturulduktan sonra, şube yönetiçiniz uygulamayı indirip <b>{inviteCode || '...'}</b> koduyla kayıt olmalıdır.
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button onClick={() => setShowAddModal(false)} className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200">İptal</button>
                                    <button onClick={handleAddBranch} disabled={saving} className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-xl shadow-indigo-100 hover:bg-indigo-700">
                                        {saving ? "Oluşturuluyor..." : "Şubeyi Oluştur"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
