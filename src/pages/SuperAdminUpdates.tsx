import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { 
    Plus, 
    Archive,
    AlertTriangle,
    ChevronRight,
    Calendar,
    Globe
} from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { cn } from "../utils/cn";

type AppUpdate = {
    id: string;
    version: string;
    title: string;
    description: string;
    update_type: 'general' | 'bugfix' | 'feature' | 'security';
    target_type: 'all_companies' | 'selected_companies';
    target_company_ids: string[];
    status: 'draft' | 'published' | 'archived';
    force_update: boolean;
    forced_update: boolean;
    release_date: string | null;
    published_at: string | null;
    created_at: string;
};

export default function SuperAdminUpdates() {
    const [updates, setUpdates] = useState<AppUpdate[]>([]);
    const [loading, setLoading] = useState(true);
    const [showNewModal, setShowNewModal] = useState(false);

    const [form, setForm] = useState<Partial<AppUpdate>>({
        version: "1.0.0",
        title: "",
        description: "",
        update_type: 'general',
        target_type: 'all_companies',
        target_company_ids: [],
        status: 'draft',
        force_update: false,
        forced_update: false,
        release_date: new Date().toISOString()
    });

    useEffect(() => {
        loadUpdates();
    }, []);

    async function loadUpdates() {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('app_updates')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            setUpdates((data ?? []) as AppUpdate[]);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }



    async function handleSave() {
        try {
            const isUpdate = !!form.id;
            const payload = { ...form };
            payload.status = 'published';
            payload.published_at = payload.published_at || new Date().toISOString();
            payload.release_date = payload.release_date || payload.published_at;
            payload.forced_update = Boolean(payload.force_update || payload.forced_update);
            payload.force_update = payload.forced_update;

            const { data: auth } = await supabase.auth.getUser();
            const writePayload = {
                ...payload,
                created_by: isUpdate ? undefined : auth.user?.id,
            };

            const result = isUpdate 
                ? await supabase.from('app_updates').update(writePayload).eq('id', form.id).select('*').single()
                : await supabase.from('app_updates').insert([writePayload]).select('*').single();

            if (result.error) throw result.error;
            const savedUpdate = result.data as AppUpdate;

            if (payload.status === 'published') {
                let memberQuery = supabase
                    .from('company_members')
                    .select('company_id,user_id');

                if (savedUpdate.target_type === 'selected_companies' && savedUpdate.target_company_ids?.length) {
                    memberQuery = memberQuery.in('company_id', savedUpdate.target_company_ids);
                }

                const { data: members, error: memberError } = await memberQuery;
                if (memberError) throw memberError;

                const notifications = (members ?? []).map((member: any) => ({
                    company_id: member.company_id,
                    user_id: member.user_id,
                    title: `Yeni güncelleme yayınlandı: v${savedUpdate.version}`,
                    message: `${savedUpdate.title}${savedUpdate.description ? ` - ${savedUpdate.description}` : ""}`,
                    type: 'update',
                    related_update_id: savedUpdate.id,
                    is_read: false,
                }));

                if (notifications.length > 0) {
                    const { error: notificationError } = await supabase.from('notifications').insert(notifications);
                    if (notificationError) throw notificationError;
                }
            }

            setShowNewModal(false);
            loadUpdates();
        } catch (e) {
            console.error(e);
        }
    }

    const typeMap = {
        general: { label: 'Genel', color: 'blue' },
        bugfix: { label: 'Hata Düzeltme', color: 'emerald' },
        feature: { label: 'Yeni Özellik', color: 'amber' },
        security: { label: 'Güvenlik', color: 'red' }
    };

    if (loading) return <div className="p-8 text-center">Yükleniyor...</div>;

    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white">Güncelleme Yönetimi</h1>
                    <p className="text-slate-500 mt-1">Uygulama sürümlerini ve duyuruları yönetin.</p>
                </div>
                
                <button 
                    onClick={() => {
                        setForm({
                            version: "1.0.0",
                            title: "",
                            description: "",
                            update_type: 'general',
                            target_type: 'all_companies',
                            target_company_ids: [],
                            status: 'draft',
                            force_update: false,
                            forced_update: false,
                            release_date: new Date().toISOString()
                        });
                        setShowNewModal(true);
                    }}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-lg shadow-blue-600/20 transition-all"
                >
                    <Plus size={20} /> Yeni Güncelleme
                </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {updates.map((up) => (
                    <div 
                        key={up.id}
                        className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 flex flex-col md:flex-row md:items-center justify-between gap-6"
                    >
                        <div className="flex items-center gap-4">
                            <div className={cn(
                                "w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl",
                                up.status === 'published' ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400"
                            )}>
                                v{up.version}
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    {up.title}
                                    {(up.force_update || up.forced_update) && <AlertTriangle size={16} className="text-red-500" />}
                                </h3>
                                <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                                    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest", `bg-${typeMap[up.update_type].color}-100 text-${typeMap[up.update_type].color}-600`)}>
                                        {typeMap[up.update_type].label}
                                    </span>
                                    <span className="flex items-center gap-1"><Globe size={14} /> {up.target_type === 'all_companies' ? 'Tüm Firmalar' : 'Özel Seçim'}</span>
                                    {up.published_at && <span className="flex items-center gap-1"><Calendar size={14} /> {format(new Date(up.published_at), 'dd MMM yyyy', { locale: tr })}</span>}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="text-right hidden sm:block">
                                <div className={cn(
                                    "text-xs font-black uppercase tracking-widest",
                                    up.status === 'published' ? "text-emerald-600" : "text-slate-400"
                                )}>
                                    {up.status === 'published' ? 'Yayında' : up.status === 'archived' ? 'Arşivlendi' : 'Taslak'}
                                </div>
                                <div className="text-[10px] text-slate-400">{format(new Date(up.created_at), 'dd.MM.yyyy')}</div>
                            </div>
                            <button 
                                onClick={() => {
                                    setForm(up);
                                    setShowNewModal(true);
                                }}
                                className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-blue-600 transition-all"
                            >
                                <ChevronRight size={24} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modal placeholder */}
            {showNewModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex justify-between items-center">
                            <h2 className="text-xl font-black text-slate-900 dark:text-white">Yeni Güncelleme / Duyuru</h2>
                            <button onClick={() => setShowNewModal(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400"><Archive size={20}/></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase text-slate-400">Versiyon</label>
                                    <input value={form.version} onChange={(e)=>setForm({...form, version: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border outline-none font-bold"/>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase text-slate-400">Tür</label>
                                    <select value={form.update_type} onChange={(e)=>setForm({...form, update_type: e.target.value as any})} className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border outline-none font-bold">
                                        <option value="general">Genel</option>
                                        <option value="bugfix">Hata Düzeltme</option>
                                        <option value="feature">Yeni Özellik</option>
                                        <option value="security">Güvenlik</option>
                                    </select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-400">Başlık</label>
                                <input value={form.title} onChange={(e)=>setForm({...form, title: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border outline-none font-bold"/>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-400">Açıklama</label>
                                <textarea value={form.description} onChange={(e)=>setForm({...form, description: e.target.value})} className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border outline-none min-h-[150px]"/>
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="checkbox" checked={Boolean(form.force_update || form.forced_update)} onChange={(e)=>setForm({...form, force_update: e.target.checked, forced_update: e.target.checked})} className="w-4 h-4 rounded text-red-600"/>
                                <label className="text-sm font-bold text-slate-600">Zorunlu Güncelleme (Tüm kullanıcıları uyar)</label>
                            </div>
                        </div>
                        <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-t flex justify-end gap-3">
                            <button onClick={()=>setShowNewModal(false)} className="px-6 py-2 text-sm font-bold text-slate-500">İptal</button>
                            <button onClick={handleSave} className="px-8 py-2 bg-blue-600 text-white rounded-xl font-bold">Kaydet ve Yayınla</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
