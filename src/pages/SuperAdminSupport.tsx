import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { 
    MessageSquare, 
    Search, 
    Building2,
    Send,
    User,
    AlertTriangle,
    CheckCircle2,
    Clock,
    LifeBuoy
} from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { cn } from "../utils/cn";

type SupportTicket = {
    id: string;
    company_id: string;
    user_id: string;
    title: string;
    description: string;
    status: 'open' | 'in_progress' | 'resolved' | 'closed';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    category: 'bug' | 'question' | 'request' | 'payment' | 'other';
    page_url: string | null;
    screenshot_url: string | null;
    created_at: string;
    internal_note: string | null;
    company?: { name: string };
    profile?: { full_name: string };
};

export default function SuperAdminSupport() {
    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [priorityFilter, setPriorityFilter] = useState<string>("all");
    const [categoryFilter, setCategoryFilter] = useState<string>("all");
    const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
    const [internalNote, setInternalNote] = useState("");
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        loadTickets();
    }, []);

    async function loadTickets() {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('support_tickets')
                .select('*, company:companies(name), profile:profiles(full_name)')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setTickets((data ?? []) as SupportTicket[]);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function updateTicket(id: string, patch: Partial<SupportTicket>) {
        setUpdating(true);
        try {
            const { error } = await supabase
                .from('support_tickets')
                .update(patch)
                .eq('id', id);

            if (error) throw error;
            
            // If resolved, create a notification for the user
            if (patch.status === 'resolved') {
                const ticket = tickets.find(t => t.id === id);
                if (ticket) {
                    await supabase.from('notifications').insert({
                        company_id: ticket.company_id,
                        user_id: ticket.user_id,
                        title: 'Destek Talebi Çözüldü',
                        message: `"${ticket.title}" konulu destek talebiniz çözüldü. Lütfen kontrol edin.`,
                        type: 'success',
                        related_ticket_id: ticket.id
                    });
                }
            }

            await loadTickets();
            if (selectedTicket?.id === id) {
                const updated = tickets.find(t => t.id === id);
                if (updated) setSelectedTicket({ ...updated, ...patch });
            }
        } catch (e) {
            console.error(e);
        } finally {
            setUpdating(false);
        }
    }

    const filtered = tickets.filter(t => {
        const matchesSearch = t.title.toLowerCase().includes(search.toLowerCase()) || 
                             t.company?.name.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
        const matchesPriority = priorityFilter === 'all' || t.priority === priorityFilter;
        const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
        return matchesSearch && matchesStatus && matchesPriority && matchesCategory;
    });

    const supportStats = useMemo(() => {
        const open = tickets.filter((t) => t.status === "open").length;
        const inProgress = tickets.filter((t) => t.status === "in_progress").length;
        const urgent = tickets.filter((t) => t.priority === "urgent" || t.priority === "high").length;
        const resolved = tickets.filter((t) => t.status === "resolved" || t.status === "closed").length;
        return [
            { label: "Açık Problem", value: open, icon: LifeBuoy, tone: "bg-blue-50 text-blue-700 border-blue-100" },
            { label: "İşlemde", value: inProgress, icon: Clock, tone: "bg-amber-50 text-amber-700 border-amber-100" },
            { label: "Acil / Yüksek", value: urgent, icon: AlertTriangle, tone: "bg-red-50 text-red-700 border-red-100" },
            { label: "Çözülen", value: resolved, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700 border-emerald-100" },
        ];
    }, [tickets]);

    const statusMap = {
        open: { label: 'Açık', color: 'blue' },
        in_progress: { label: 'İşleniyor', color: 'amber' },
        resolved: { label: 'Çözüldü', color: 'emerald' },
        closed: { label: 'Kapalı', color: 'slate' }
    };

    const priorityMap = {
        low: { label: 'Düşük', color: 'slate' },
        medium: { label: 'Orta', color: 'blue' },
        high: { label: 'Yüksek', color: 'orange' },
        urgent: { label: 'Acil', color: 'red' }
    };

    const categoryMap = {
        bug: "Hata",
        question: "Soru",
        request: "İstek",
        payment: "Ödeme",
        other: "Diğer",
    };

    if (loading) return <div className="p-8 text-center">Yükleniyor...</div>;

    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white">Destek / Hata Merkezi</h1>
                    <p className="text-slate-500 mt-1">Kullanıcıların bildirdiği problemleri, hataları ve istekleri tek merkezden takip edin.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {supportStats.map((item) => (
                    <div key={item.label} className={`rounded-2xl border p-4 ${item.tone}`}>
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-2xl font-black">{item.value}</div>
                                <div className="mt-1 text-sm font-bold">{item.label}</div>
                            </div>
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/70">
                                <item.icon className="h-5 w-5" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Tickets List */}
                <div className="lg:col-span-1 space-y-4">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input 
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Talep veya firma ara..."
                                className="w-full pl-9 pr-4 py-2 text-sm rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                            />
                        </div>
                        <select 
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="px-3 py-2 text-sm rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
                        >
                            <option value="all">Tümü</option>
                            <option value="open">Açık</option>
                            <option value="in_progress">İşleniyor</option>
                            <option value="resolved">Çözüldü</option>
                        </select>
                        <select 
                            value={priorityFilter}
                            onChange={(e) => setPriorityFilter(e.target.value)}
                            className="px-3 py-2 text-sm rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
                        >
                            <option value="all">Tüm öncelikler</option>
                            <option value="low">Düşük</option>
                            <option value="medium">Orta</option>
                            <option value="high">Yüksek</option>
                            <option value="urgent">Acil</option>
                        </select>
                        <select 
                            value={categoryFilter}
                            onChange={(e) => setCategoryFilter(e.target.value)}
                            className="px-3 py-2 text-sm rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none"
                        >
                            <option value="all">Tüm kategoriler</option>
                            <option value="bug">Hata</option>
                            <option value="question">Soru</option>
                            <option value="request">Talep</option>
                            <option value="payment">Ödeme</option>
                            <option value="other">Diğer</option>
                        </select>
                    </div>

                    <div className="space-y-3 h-[calc(100vh-250px)] overflow-y-auto pr-2">
                        {filtered.map((t) => (
                            <button
                                key={t.id}
                                onClick={() => {
                                    setSelectedTicket(t);
                                    setInternalNote(t.internal_note || "");
                                }}
                                className={cn(
                                    "w-full text-left p-4 rounded-2xl border transition-all",
                                    selectedTicket?.id === t.id 
                                        ? "bg-blue-600 border-blue-600 shadow-lg shadow-blue-600/20" 
                                        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-300"
                                )}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className={cn(
                                        "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full",
                                        selectedTicket?.id === t.id 
                                            ? "bg-white/20 text-white" 
                                            : `bg-${statusMap[t.status].color}-100 dark:bg-${statusMap[t.status].color}-900/30 text-${statusMap[t.status].color}-600 dark:text-${statusMap[t.status].color}-400`
                                    )}>
                                        {statusMap[t.status].label}
                                    </span>
                                    <span className={cn(
                                        "text-[10px] font-bold",
                                        selectedTicket?.id === t.id ? "text-blue-100" : "text-slate-400"
                                    )}>
                                        {format(new Date(t.created_at), 'HH:mm')}
                                    </span>
                                </div>
                                <h4 className={cn(
                                    "font-bold truncate mb-1",
                                    selectedTicket?.id === t.id ? "text-white" : "text-slate-900 dark:text-white"
                                )}>
                                    {t.title}
                                </h4>
                                <div className={cn(
                                    "text-xs truncate",
                                    selectedTicket?.id === t.id ? "text-blue-100" : "text-slate-500"
                                )}>
                                    {t.company?.name || "Firma"} • {t.profile?.full_name || "Kullanıcı"}
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <span className={cn(
                                        "rounded-full px-2 py-1 text-[10px] font-black",
                                        selectedTicket?.id === t.id ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"
                                    )}>
                                        {categoryMap[t.category]}
                                    </span>
                                    <span className={cn(
                                        "rounded-full px-2 py-1 text-[10px] font-black",
                                        selectedTicket?.id === t.id ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"
                                    )}>
                                        {priorityMap[t.priority].label}
                                    </span>
                                </div>
                            </button>
                        ))}
                        {filtered.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                                Bu filtrelerde problem kaydı yok.
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* Ticket Detail */}
                <div className="lg:col-span-2">
                    {selectedTicket ? (
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-200px)]">
                            <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-blue-600 shadow-sm">
                                            <MessageSquare size={24} />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-black text-slate-900 dark:text-white">{selectedTicket.title}</h2>
                                            <div className="flex items-center gap-3 text-sm text-slate-500">
                                                <span className="flex items-center gap-1"><Building2 size={14} /> {selectedTicket.company?.name}</span>
                                                <span className="flex items-center gap-1"><User size={14} /> {selectedTicket.profile?.full_name}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <select 
                                            value={selectedTicket.status}
                                            onChange={(e) => updateTicket(selectedTicket.id, { status: e.target.value as any })}
                                            className="px-4 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold outline-none"
                                        >
                                            {Object.entries(statusMap).map(([k, v]) => (
                                                <option key={k} value={k}>{v.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                    <button
                                        type="button"
                                        onClick={() => updateTicket(selectedTicket.id, { status: "in_progress" })}
                                        disabled={updating}
                                        className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
                                    >
                                        İşleme Al
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => updateTicket(selectedTicket.id, { status: "resolved" })}
                                        disabled={updating}
                                        className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
                                    >
                                        Çözüldü
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => updateTicket(selectedTicket.id, { status: "closed" })}
                                        disabled={updating}
                                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
                                    >
                                        Kapat
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-8 space-y-8">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                                        <div className="text-[10px] font-black uppercase text-slate-400 mb-1">Öncelik</div>
                                        <div className={cn("text-sm font-black", `text-${priorityMap[selectedTicket.priority].color}-600`)}>
                                            {priorityMap[selectedTicket.priority].label}
                                        </div>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                                        <div className="text-[10px] font-black uppercase text-slate-400 mb-1">Kategori</div>
                                        <div className="text-sm font-black text-slate-900 dark:text-white">{categoryMap[selectedTicket.category]}</div>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                                        <div className="text-[10px] font-black uppercase text-slate-400 mb-1">Tarih</div>
                                        <div className="text-sm font-black text-slate-900 dark:text-white">
                                            {format(new Date(selectedTicket.created_at), 'dd MMMM yyyy', { locale: tr })}
                                        </div>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                                        <div className="text-[10px] font-black uppercase text-slate-400 mb-1">Sayfa</div>
                                        <div className="text-sm font-black text-blue-600 truncate">
                                            {selectedTicket.page_url || '-'}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <h4 className="text-sm font-black uppercase text-slate-400 tracking-widest">Kullanıcının Bildirdiği Problem</h4>
                                    <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 leading-relaxed">
                                        {selectedTicket.description}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                    <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                                        <div className="text-xs font-black uppercase text-slate-400">1. Kayıt</div>
                                        <div className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">Kullanıcı problemi bildirdi.</div>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                                        <div className="text-xs font-black uppercase text-slate-400">2. Takip</div>
                                        <div className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">Süper admin durum ve iç not ekler.</div>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                                        <div className="text-xs font-black uppercase text-slate-400">3. Sonuç</div>
                                        <div className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">Çözülünce kullanıcıya bildirim gider.</div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <h4 className="text-sm font-black uppercase text-slate-400 tracking-widest">İç Not (Sadece Süper Admin Görür)</h4>
                                    <div className="space-y-3">
                                        <textarea 
                                            value={internalNote}
                                            onChange={(e) => setInternalNote(e.target.value)}
                                            placeholder="Bu talep hakkında iç not ekle..."
                                            className="w-full p-4 rounded-2xl bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 outline-none focus:ring-2 focus:ring-amber-500/20 text-sm h-32"
                                        />
                                        <button 
                                            onClick={() => updateTicket(selectedTicket.id, { internal_note: internalNote })}
                                            disabled={updating}
                                            className="px-6 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all flex items-center gap-2"
                                        >
                                            <Send size={16} /> Notu Kaydet
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 border-dashed p-12 text-center">
                            <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-300 mb-4">
                                <MessageSquare size={40} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Detayları Görüntüle</h3>
                            <p className="text-slate-500 max-w-xs mt-2">Sol taraftan bir destek talebi seçerek detaylarını ve yazışmaları görebilirsiniz.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
