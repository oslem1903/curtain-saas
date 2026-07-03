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
    LifeBuoy,
    MonitorSmartphone,
    Plus,
    Trash2,
    X
} from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { cn } from "../utils/cn";
import AdminInterventionPanel from "../components/AdminInterventionPanel";

type SupportCategory = 'order' | 'measurement' | 'installation' | 'supplier' | 'customer' | 'payment' | 'other'
    // eski kayıtlarla uyum için
    | 'bug' | 'question' | 'request';

interface ConsoleErrorEntry {
    type?: string;
    message?: string;
    detail?: string;
    route?: string;
    at?: string;
}

type SupportTicket = {
    id: string;
    company_id: string;
    user_id: string;
    title: string;
    description: string;
    status: 'open' | 'in_progress' | 'waiting_user' | 'update_ready' | 'resolved' | 'closed';
    admin_response?: string | null;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    category: SupportCategory;
    page_url: string | null;
    screenshot_url: string | null;
    created_at: string;
    internal_note: string | null;
    support_metadata?: {
        kind?: string;
        requested_device_id?: string;
        device_name?: string;
        user_agent?: string;
        browser?: string;
        os?: string;
        platform?: string;
        screen?: string;
        viewport?: string;
        app_version?: string;
        route?: string;
        console_errors?: ConsoleErrorEntry[];
    } | null;
    company?: { name: string };
    profile?: { full_name: string };
};

// Açıklama/başlık içindeki UUID'leri yakala (sipariş/ölçü/müşteri ID'si)
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function extractRecordIds(ticket: SupportTicket): string[] {
    const text = `${ticket.title || ""} ${ticket.description || ""}`;
    return Array.from(new Set(text.match(UUID_RE) ?? []));
}

// Kategoriye göre kaydın açılacağı uygulama rotası (hash tabanlı)
function recordRoute(category: SupportCategory, id: string): string {
    switch (category) {
        case 'order':
        case 'installation':
        case 'payment':
            return `#/orders/${id}`;
        case 'measurement':
            return `#/appointments/${id}`;
        case 'supplier':
            return `#/suppliers/${id}`;
        case 'customer':
            return `#/customers`;
        default:
            return `#/orders/${id}`;
    }
}

export default function SuperAdminSupport() {
    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [priorityFilter, setPriorityFilter] = useState<string>("all");
    const [categoryFilter, setCategoryFilter] = useState<string>("all");
    const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
    const [internalNote, setInternalNote] = useState("");
    const [adminResponse, setAdminResponse] = useState("");
    const [updating, setUpdating] = useState(false);
    const [screenshotUrl, setScreenshotUrl] = useState("");
    const [showImageModal, setShowImageModal] = useState(false);

    // Seçilen talebin ekran görüntüsü için signed URL üret (private bucket)
    useEffect(() => {
        let alive = true;
        setScreenshotUrl("");
        setShowImageModal(false);
        const path = selectedTicket?.screenshot_url;
        if (!path) return;
        if (/^https?:\/\//i.test(path)) {
            // Eski kayıtlarda tam URL saklanmış olabilir
            setScreenshotUrl(path);
            return;
        }
        supabase.storage
            .from("support-attachments")
            .createSignedUrl(path, 60 * 60)
            .then(({ data }) => {
                if (alive && data?.signedUrl) setScreenshotUrl(data.signedUrl);
            }, () => {});
        return () => { alive = false; };
    }, [selectedTicket?.id, selectedTicket?.screenshot_url]);

    useEffect(() => {
        loadTickets();
    }, []);

    const [loadErr, setLoadErr] = useState("");

    async function loadTickets() {
        setLoading(true);
        setLoadErr("");
        try {
            // 1. Gömülü join'lerle dene (FK ilişkileri kuruluysa en hızlı yol)
            const firstTry = await supabase
                .from('support_tickets')
                .select('*, company:companies(name), profile:profiles(full_name)')
                .order('created_at', { ascending: false });
            let data = firstTry.data;
            const error = firstTry.error;

            // 2. profiles FK'sı yoksa PostgREST tüm sorguyu reddeder —
            //    join'siz oku, firma/kullanıcı adlarını ayrıca çek.
            if (error) {
                const plain = await supabase
                    .from('support_tickets')
                    .select('*')
                    .order('created_at', { ascending: false });
                if (plain.error) throw plain.error;

                const rows = (plain.data ?? []) as SupportTicket[];
                const companyIds = Array.from(new Set(rows.map((r) => r.company_id).filter(Boolean)));
                const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));

                const [companiesRes, profilesRes] = await Promise.all([
                    companyIds.length > 0
                        ? supabase.from('companies').select('id, name').in('id', companyIds)
                        : Promise.resolve({ data: [] as any[] }),
                    userIds.length > 0
                        ? supabase.from('profiles').select('user_id, full_name').in('user_id', userIds)
                        : Promise.resolve({ data: [] as any[] }),
                ]);

                const companyMap = new Map(((companiesRes.data ?? []) as any[]).map((c) => [c.id, c.name]));
                const profileMap = new Map(((profilesRes.data ?? []) as any[]).map((p) => [p.user_id, p.full_name]));

                data = rows.map((r) => ({
                    ...r,
                    company: { name: companyMap.get(r.company_id) || "Firma" },
                    profile: { full_name: profileMap.get(r.user_id) || "Kullanıcı" },
                })) as any;
            }

            setTickets((data ?? []) as SupportTicket[]);
        } catch (e: any) {
            console.error(e);
            setLoadErr(
                /support_tickets|does not exist|schema cache/i.test(String(e?.message || ""))
                    ? "Destek tablosu bulunamadı. supabase_fix_support_tickets.sql dosyasını SQL Editor'da çalıştırın."
                    : "Destek talepleri yüklenemedi. Lütfen sayfayı yenileyin."
            );
        } finally {
            setLoading(false);
        }
    }

    // Durum → kullanıcı bildirimi eşlemesi
    const STATUS_NOTIFICATIONS: Record<string, { title: string; message: string; type: string }> = {
        in_progress: { title: 'Destek Talebiniz İnceleniyor', message: 'Destek talebiniz inceleniyor.', type: 'info' },
        waiting_user: { title: 'Ek Bilgi Gerekiyor', message: 'Destek talebiniz için ek bilgi gerekiyor.', type: 'warning' },
        update_ready: { title: 'Güncelleme Hazır', message: 'Destek talebiniz için güncelleme hazırlandı.', type: 'update' },
        resolved: { title: 'Destek Talebi Çözüldü', message: 'Destek talebiniz çözüldü.', type: 'success' },
        closed: { title: 'Destek Talebi Kapatıldı', message: 'Destek talebiniz kapatıldı.', type: 'info' },
    };

    async function updateTicket(id: string, patch: Partial<SupportTicket>) {
        setUpdating(true);
        try {
            // Durum değişiminde zaman damgalarını da işle
            const fullPatch: Record<string, any> = { ...patch, updated_at: new Date().toISOString() };
            if (patch.status === 'resolved') fullPatch.resolved_at = new Date().toISOString();
            if (patch.status === 'closed') fullPatch.closed_at = new Date().toISOString();

            let { error } = await supabase
                .from('support_tickets')
                .update(fullPatch)
                .eq('id', id);

            // Yeni kolonlar (closed_at/updated_at) henüz yoksa çekirdek patch ile yeniden dene
            if (error && /column|schema cache/i.test(String(error.message || ''))) {
                const retry = await supabase.from('support_tickets').update(patch).eq('id', id);
                error = retry.error;
            }
            if (error) throw error;

            // Durum değişiminde ilgili kullanıcıya bildirim gönder
            if (patch.status && STATUS_NOTIFICATIONS[patch.status]) {
                const ticket = tickets.find(t => t.id === id);
                const notif = STATUS_NOTIFICATIONS[patch.status];
                if (ticket?.user_id) {
                    await supabase.from('notifications').insert({
                        company_id: ticket.company_id,
                        user_id: ticket.user_id,
                        title: notif.title,
                        message: `"${ticket.title}" — ${notif.message}`,
                        type: notif.type,
                        related_ticket_id: ticket.id
                    }).then(() => {}, () => {});
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

    function isDeviceLimitTicket(ticket: SupportTicket | null) {
        if (!ticket) return false;
        return ticket.support_metadata?.kind === "device_limit" || /cihaz/i.test(`${ticket.title || ""} ${ticket.description || ""}`);
    }

    async function approveDeviceTicket(action: "increase_limit" | "remove_device") {
        if (!selectedTicket) return;
        setUpdating(true);
        try {
            const { error } = await supabase.rpc("super_admin_approve_device_request", {
                p_ticket_id: selectedTicket.id,
                p_action: action,
                p_remove_device_id: null,
            });

            if (error) throw error;

            const response = action === "increase_limit"
                ? "Cihaz limitiniz artirildi. Tekrar giris yapabilirsiniz."
                : "Eski cihaz kaldirildi. Yeni cihazdan tekrar giris yapabilirsiniz.";

            setAdminResponse(response);
            setSelectedTicket({ ...selectedTicket, status: "resolved", admin_response: response });
            await loadTickets();
        } catch (e: any) {
            alert(e?.message || "Cihaz talebi onaylanamadi. Supabase migration dosyasinin calistigindan emin olun.");
        } finally {
            setUpdating(false);
        }
    }

    const filtered = tickets.filter(t => {
        const q = search.toLowerCase();
        const matchesSearch = !q ||
                             (t.title ?? "").toLowerCase().includes(q) ||
                             (t.company?.name ?? "").toLowerCase().includes(q);
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

    const statusMap: Record<string, { label: string; color: string }> = {
        open: { label: 'Yeni Talep', color: 'blue' },
        in_progress: { label: 'İnceleniyor', color: 'amber' },
        waiting_user: { label: 'Kullanıcıdan Bilgi Bekleniyor', color: 'orange' },
        update_ready: { label: 'Güncelleme Hazır', color: 'violet' },
        resolved: { label: 'Çözüldü', color: 'emerald' },
        closed: { label: 'Kapatıldı', color: 'slate' }
    };

    const priorityMap = {
        low: { label: 'Düşük', color: 'slate' },
        medium: { label: 'Orta', color: 'blue' },
        high: { label: 'Yüksek', color: 'orange' },
        urgent: { label: 'Acil', color: 'red' }
    };

    const categoryMap: Record<string, string> = {
        order: "Sipariş",
        measurement: "Ölçü / Teklif",
        installation: "Montaj",
        supplier: "Tedarikçi",
        customer: "Müşteri",
        payment: "Ödeme / Tahsilat",
        other: "Diğer",
        // eski kayıtlar
        bug: "Hata",
        question: "Soru",
        request: "İstek",
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

            {loadErr && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                    {loadErr}
                </div>
            )}

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
                            <option value="order">Sipariş</option>
                            <option value="measurement">Ölçü / Teklif</option>
                            <option value="installation">Montaj</option>
                            <option value="supplier">Tedarikçi</option>
                            <option value="customer">Müşteri</option>
                            <option value="payment">Ödeme / Tahsilat</option>
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
                                    setAdminResponse(t.admin_response || "");
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
                                            : `bg-${(statusMap[t.status] ?? statusMap.open).color}-100 dark:bg-${(statusMap[t.status] ?? statusMap.open).color}-900/30 text-${(statusMap[t.status] ?? statusMap.open).color}-600 dark:text-${(statusMap[t.status] ?? statusMap.open).color}-400`
                                    )}>
                                        {(statusMap[t.status] ?? statusMap.open).label}
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

                                {isDeviceLimitTicket(selectedTicket) && selectedTicket.status !== "resolved" && selectedTicket.status !== "closed" && (
                                    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900/50 dark:bg-blue-950/20">
                                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                            <div className="flex items-start gap-3">
                                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm dark:bg-slate-900">
                                                    <MonitorSmartphone size={22} />
                                                </div>
                                                <div>
                                                    <h4 className="text-sm font-black uppercase tracking-widest text-blue-700 dark:text-blue-200">Cihaz Limiti Aksiyonu</h4>
                                                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                                        Bu talebi buradan onaylayabilirsiniz. Kullanici onaydan sonra kilit ekraninda Tekrar Dene ile giris yapar.
                                                    </p>
                                                    {selectedTicket.support_metadata?.device_name || selectedTicket.support_metadata?.requested_device_id ? (
                                                        <p className="mt-2 text-xs font-bold text-slate-500">
                                                            Talep edilen cihaz: {selectedTicket.support_metadata?.device_name || selectedTicket.support_metadata?.requested_device_id}
                                                        </p>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:min-w-[360px]">
                                                <button
                                                    type="button"
                                                    disabled={updating}
                                                    onClick={() => approveDeviceTicket("increase_limit")}
                                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                                                >
                                                    <Plus size={17} />
                                                    Limiti +1 Artir
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={updating}
                                                    onClick={() => approveDeviceTicket("remove_device")}
                                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60"
                                                >
                                                    <Trash2 size={17} />
                                                    En Eski Cihazi Kaldir
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-3">
                                    <h4 className="text-sm font-black uppercase text-slate-400 tracking-widest">Kullanıcının Bildirdiği Problem</h4>
                                    <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 leading-relaxed">
                                        {selectedTicket.description}
                                    </div>
                                </div>

                                {/* İlgili Kayıtlar — sipariş/ölçü/müşteri ID'sini direkt aç */}
                                {(extractRecordIds(selectedTicket).length > 0 || selectedTicket.page_url) && (
                                    <div className="space-y-3">
                                        <h4 className="text-sm font-black uppercase text-slate-400 tracking-widest">İlgili Kayıtlar</h4>
                                        <div className="flex flex-wrap gap-2">
                                            {selectedTicket.page_url && (
                                                <a
                                                    href={selectedTicket.page_url.startsWith("#") ? selectedTicket.page_url : `#${selectedTicket.page_url}`}
                                                    className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300"
                                                >
                                                    Kullanıcının olduğu sayfayı aç
                                                </a>
                                            )}
                                            {extractRecordIds(selectedTicket).map((rid) => (
                                                <a
                                                    key={rid}
                                                    href={recordRoute(selectedTicket.category, rid)}
                                                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                                >
                                                    {categoryMap[selectedTicket.category] || "Kayıt"}: {rid.slice(0, 8)}… ↗
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Teknik Bilgi — cihaz / tarayıcı / sürüm */}
                                {selectedTicket.support_metadata && (
                                    <div className="space-y-3">
                                        <h4 className="text-sm font-black uppercase text-slate-400 tracking-widest">Teknik Bilgi</h4>
                                        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                                            {[
                                                ["Tarayıcı", selectedTicket.support_metadata.browser],
                                                ["İşletim Sistemi", selectedTicket.support_metadata.os],
                                                ["Platform", selectedTicket.support_metadata.platform],
                                                ["Sürüm", selectedTicket.support_metadata.app_version],
                                                ["Ekran", selectedTicket.support_metadata.screen],
                                                ["Görünüm", selectedTicket.support_metadata.viewport],
                                                ["Rota", selectedTicket.support_metadata.route],
                                            ].filter(([, v]) => v).map(([label, value]) => (
                                                <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/30">
                                                    <div className="text-[10px] font-black uppercase text-slate-400">{label}</div>
                                                    <div className="truncate text-xs font-bold text-slate-700 dark:text-slate-200" title={String(value)}>{String(value)}</div>
                                                </div>
                                            ))}
                                        </div>
                                        {selectedTicket.support_metadata.user_agent && (
                                            <div className="truncate rounded-lg bg-slate-50 px-3 py-1.5 font-mono text-[10px] text-slate-400 dark:bg-slate-800/30" title={selectedTicket.support_metadata.user_agent}>
                                                {selectedTicket.support_metadata.user_agent}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Otomatik Yakalanan Hata Logları */}
                                {(selectedTicket.support_metadata?.console_errors?.length ?? 0) > 0 && (
                                    <div className="space-y-3">
                                        <h4 className="flex items-center gap-2 text-sm font-black uppercase text-slate-400 tracking-widest">
                                            <AlertTriangle size={15} className="text-red-500" /> Hata Logları (otomatik)
                                        </h4>
                                        <div className="space-y-2 rounded-2xl border border-red-100 bg-red-50/40 p-3 dark:border-red-900/30 dark:bg-red-950/10">
                                            {selectedTicket.support_metadata!.console_errors!.map((err, i) => (
                                                <div key={i} className="rounded-lg bg-white/70 p-2 dark:bg-slate-900/40">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-red-700 dark:bg-red-900/40 dark:text-red-300">{err.type || "error"}</span>
                                                        {err.route && <span className="font-mono text-[10px] text-slate-400">{err.route}</span>}
                                                    </div>
                                                    <div className="mt-1 break-words font-mono text-[11px] text-slate-700 dark:text-slate-300">{err.message}</div>
                                                    {err.detail && <div className="mt-0.5 break-words font-mono text-[10px] text-slate-400">{err.detail}</div>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Admin Müdahale & İşlem Geçmişi & Geri Alma */}
                                <div className="space-y-3 rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
                                    <h4 className="text-sm font-black uppercase text-slate-400 tracking-widest">Uzaktan Müdahale & İşlem Geçmişi</h4>
                                    <AdminInterventionPanel
                                        companyId={selectedTicket.company_id}
                                        companyName={selectedTicket.company?.name}
                                        ticketId={selectedTicket.id}
                                        defaultCategory={selectedTicket.category}
                                        suggestedRecordId={extractRecordIds(selectedTicket)[0] ?? null}
                                    />
                                </div>

                                {/* Ekran Görüntüsü */}
                                {selectedTicket.screenshot_url && (
                                    <div className="space-y-3">
                                        <h4 className="text-sm font-black uppercase text-slate-400 tracking-widest">Ekran Görüntüsü</h4>
                                        {screenshotUrl ? (
                                            <div className="flex items-start gap-4">
                                                <button type="button" onClick={() => setShowImageModal(true)} title="Büyütmek için tıklayın">
                                                    <img
                                                        src={screenshotUrl}
                                                        alt="Ekran görüntüsü"
                                                        className="h-32 w-auto max-w-[240px] rounded-xl border border-slate-200 object-cover shadow-sm transition hover:shadow-md dark:border-slate-700"
                                                    />
                                                </button>
                                                <a
                                                    href={screenshotUrl}
                                                    download
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                                >
                                                    İndir
                                                </a>
                                            </div>
                                        ) : (
                                            <div className="text-sm text-slate-400">Görüntü yükleniyor...</div>
                                        )}
                                    </div>
                                )}

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

                                {/* Kullanıcıya gösterilecek yanıt — destek geçmişinde görünür */}
                                <div className="space-y-3">
                                    <h4 className="text-sm font-black uppercase text-slate-400 tracking-widest">Kullanıcıya Yanıt</h4>
                                    <div className="space-y-3">
                                        <textarea
                                            value={adminResponse}
                                            onChange={(e) => setAdminResponse(e.target.value)}
                                            placeholder="Kullanıcının destek geçmişinde göreceği açıklama..."
                                            className="w-full p-4 rounded-2xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 outline-none focus:ring-2 focus:ring-blue-500/20 text-sm h-24"
                                        />
                                        <button
                                            onClick={() => updateTicket(selectedTicket.id, { admin_response: adminResponse } as any)}
                                            disabled={updating}
                                            className="px-6 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all flex items-center gap-2"
                                        >
                                            <Send size={16} /> Yanıtı Kaydet
                                        </button>
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

            {/* Büyük ekran görüntüsü modalı */}
            {showImageModal && screenshotUrl && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-6"
                    onClick={() => setShowImageModal(false)}
                >
                    <div className="relative max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
                        <img src={screenshotUrl} alt="Ekran görüntüsü (büyük)" className="max-h-[85vh] w-auto rounded-2xl shadow-2xl" />
                        <div className="absolute -top-3 -right-3 flex gap-2">
                            <a
                                href={screenshotUrl}
                                download
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-lg hover:bg-slate-100"
                            >
                                İndir
                            </a>
                            <button
                                type="button"
                                onClick={() => setShowImageModal(false)}
                                className="rounded-full bg-white p-2 text-slate-700 shadow-lg hover:bg-slate-100"
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
