import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { 
    Bell, 
    Send, 
    CheckCircle2, 
    History
} from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { cn } from "../utils/cn";

type Company = { id: string; name: string };
type Notification = {
    id: string;
    company_id: string | null;
    user_id: string | null;
    title: string;
    message: string;
    type: 'info' | 'warning' | 'success' | 'error' | 'update';
    is_read: boolean;
    created_at: string;
    company?: { name: string };
};

export default function SuperAdminNotifications() {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);

    const [form, setForm] = useState({
        target: 'all' as 'all' | 'selected',
        company_ids: [] as string[],
        title: '',
        message: '',
        type: 'info' as any
    });

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [cos, notifs] = await Promise.all([
                supabase.from('companies').select('id, name'),
                supabase.from('notifications').select('*, company:companies(name)').order('created_at', { ascending: false }).limit(50)
            ]);
            if (cos.data) setCompanies(cos.data);
            if (notifs.data) setNotifications(notifs.data as Notification[]);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleSend() {
        if (!form.title || !form.message) return;
        setSending(true);
        try {
            // This is simplified. In reality, we need to create notifications for ALL users in targeted companies.
            // A more scalable way would be an edge function that handles the fan-out.
            // For MVP, let's create a notification for the ADMINS of the companies.
            
            const targetCompanyIds = form.target === 'all' ? companies.map(c => c.id) : form.company_ids;

            // Get users for these companies
            const { data: members } = await supabase
                .from('company_members')
                .select('user_id, company_id')
                .in('company_id', targetCompanyIds);

            if (!members || members.length === 0) return;

            const payloads = members.map(m => ({
                company_id: m.company_id,
                user_id: m.user_id,
                title: form.title,
                message: form.message,
                type: form.type
            }));

            const { error } = await supabase.from('notifications').insert(payloads);
            if (error) throw error;

            setForm({ ...form, title: '', message: '' });
            alert("Bildirimler başarıyla gönderildi!");
            loadData();
        } catch (e) {
            console.error(e);
        } finally {
            setSending(false);
        }
    }

    if (loading) return <div className="p-8 text-center">Yükleniyor...</div>;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white">Bildirim Merkezi</h1>
                        <p className="text-slate-500 mt-1">Kullanıcılara toplu veya bireysel duyuru gönderin.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Send Notification Form */}
                <div className="lg:col-span-1">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden sticky top-6">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                            <h2 className="font-bold flex items-center gap-2"><Send size={18} className="text-blue-500" /> Yeni Bildirim</h2>
                        </div>
                        <div className="p-6 space-y-5">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-400">Hedef Kitle</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button 
                                        onClick={()=>setForm({...form, target: 'all'})}
                                        className={cn("p-3 rounded-xl border text-xs font-bold transition-all", form.target === 'all' ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200")}
                                    >
                                        Tüm Firmalar
                                    </button>
                                    <button 
                                        onClick={()=>setForm({...form, target: 'selected'})}
                                        className={cn("p-3 rounded-xl border text-xs font-bold transition-all", form.target === 'selected' ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200")}
                                    >
                                        Seçili Firmalar
                                    </button>
                                </div>
                            </div>

                            {form.target === 'selected' && (
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase text-slate-400">Firma Seçin</label>
                                    <select 
                                        multiple
                                        value={form.company_ids}
                                        onChange={(e) => setForm({...form, company_ids: Array.from(e.target.selectedOptions, o => o.value)})}
                                        className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border outline-none text-sm min-h-[120px]"
                                    >
                                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                    <p className="text-[10px] text-slate-400">Ctrl basılı tutarak birden fazla seçebilirsiniz.</p>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-400">Bildirim Türü</label>
                                <select 
                                    value={form.type} 
                                    onChange={(e)=>setForm({...form, type: e.target.value as any})}
                                    className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border outline-none text-sm font-bold"
                                >
                                    <option value="info">Bilgi (Info)</option>
                                    <option value="success">Başarı (Success)</option>
                                    <option value="warning">Uyarı (Warning)</option>
                                    <option value="error">Hata (Error)</option>
                                    <option value="update">Güncelleme (Update)</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-400">Başlık</label>
                                <input 
                                    value={form.title} 
                                    onChange={(e)=>setForm({...form, title: e.target.value})}
                                    placeholder="Bildirim başlığı..."
                                    className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border outline-none font-bold"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-400">Mesaj</label>
                                <textarea 
                                    value={form.message} 
                                    onChange={(e)=>setForm({...form, message: e.target.value})}
                                    placeholder="Kullanıcılara iletilecek mesaj..."
                                    className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border outline-none text-sm h-32"
                                />
                            </div>

                            <button 
                                onClick={handleSend}
                                disabled={sending}
                                className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-600/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                            >
                                <Send size={20} /> {sending ? 'Gönderiliyor...' : 'Bildirimi Gönder'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* History */}
                <div className="lg:col-span-2 space-y-4">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <History size={20} className="text-slate-400" /> Son Gönderilenler
                    </h3>
                    
                    <div className="space-y-3">
                        {notifications.map((n) => (
                            <div key={n.id} className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 flex gap-4">
                                <div className={cn(
                                    "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                                    n.type === 'update' ? "bg-emerald-50 text-emerald-600" :
                                    n.type === 'warning' ? "bg-amber-50 text-amber-600" :
                                    "bg-blue-50 text-blue-600"
                                )}>
                                    <Bell size={24} />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <h4 className="font-bold text-slate-900 dark:text-white">{n.title}</h4>
                                        <span className="text-[10px] text-slate-400 font-medium">
                                            {format(new Date(n.created_at), 'dd MMM HH:mm', { locale: tr })}
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{n.message}</p>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-black uppercase tracking-widest">
                                                {n.company?.name || 'Genel'}
                                            </span>
                                            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-black uppercase tracking-widest">
                                                {n.type}
                                            </span>
                                        </div>
                                        {n.is_read ? (
                                            <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                                                <CheckCircle2 size={12} /> Okundu
                                            </span>
                                        ) : (
                                            <span className="text-[10px] text-slate-400 font-bold">Okunmadı</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            </div>
        </div>
    );
}
