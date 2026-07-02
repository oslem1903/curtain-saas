import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { getEffectiveTenantContext } from "../supabaseClient";
import { 
    Bell, 
    X, 
    CheckCircle2, 
    Info, 
    AlertTriangle,
    RefreshCw,
    Circle
} from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { cn } from "../utils/cn";

type Notification = {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'warning' | 'success' | 'error' | 'update';
    is_read: boolean;
    created_at: string;
    related_ticket_id: string | null;
    related_update_id: string | null;
};

type OperationalNotification = {
    id: string;
    title: string;
    message: string;
    type: Notification["type"];
    created_at: string;
    target: string;
};

function todayRange() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

export default function NotificationBell({ userId }: { userId: string }) {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [operational, setOperational] = useState<OperationalNotification[]>([]);
    const [readOperational, setReadOperational] = useState<Set<string>>(() => {
        try {
            return new Set(JSON.parse(localStorage.getItem("dashboard_read_operational_notifications") || "[]"));
        } catch {
            return new Set();
        }
    });
    const [isOpen, setIsOpen] = useState(false);
    const visibleOperational = useMemo(() => operational.filter((item) => !readOperational.has(item.id)), [operational, readOperational]);
    const unreadCount = notifications.filter(n => !n.is_read).length + visibleOperational.length;

    const loadNotifications = useCallback(async () => {
        const { data } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20);
        
        if (data) setNotifications(data as Notification[]);
    }, [userId]);

    const loadOperationalNotifications = useCallback(async () => {
        try {
            const ctx = await getEffectiveTenantContext();
            const { start, end } = todayRange();
            const now = new Date();
            const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            const today = start.toISOString().slice(0, 10);
            const items: OperationalNotification[] = [];

            const apptRes = await supabase
                .from("appointments")
                .select("id,title,type,start_at,scheduled_at,status,done,customer:customers(name)")
                .eq("company_id", ctx.company_id)
                .gte("start_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
                .lte("start_at", soon.toISOString())
                .limit(20);

            if (!apptRes.error) {
                (apptRes.data ?? []).forEach((row: any) => {
                    const status = String(row.status || "").toLowerCase();
                    if (row.done || ["done", "completed", "cancelled", "canceled"].includes(status)) return;
                    const when = new Date(row.start_at || row.scheduled_at || "");
                    if (Number.isNaN(when.getTime())) return;
                    const cust = Array.isArray(row.customer) ? row.customer[0] : row.customer;
                    const overdue = when.getTime() < now.getTime();
                    items.push({
                        id: `appt-${row.id}-${overdue ? "late" : "soon"}`,
                        title: overdue ? "Geciken randevu" : "Yaklaşan randevu",
                        message: `${cust?.name || row.title || "Randevu"} - ${when.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`,
                        type: overdue ? "error" : "warning",
                        created_at: when.toISOString(),
                        target: `#/appointments/${row.id}`,
                    });
                });
            }

            const dueRes = await supabase
                .from("orders")
                .select("id,remaining_amount,total_amount,paid_amount,payment_due_date,customer:customers(name)")
                .eq("company_id", ctx.company_id)
                .not("payment_due_date", "is", null)
                .lte("payment_due_date", today)
                .limit(20);

            if (!dueRes.error) {
                (dueRes.data ?? []).forEach((row: any) => {
                    const remaining = Number(row.remaining_amount ?? Math.max(Number(row.total_amount ?? 0) - Number(row.paid_amount ?? 0), 0));
                    if (remaining <= 0.01) return;
                    const cust = Array.isArray(row.customer) ? row.customer[0] : row.customer;
                    items.push({
                        id: `collection-${row.id}`,
                        title: "Geciken tahsilat",
                        message: `${cust?.name || "Müşteri"} - ${new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(remaining)}`,
                        type: "error",
                        created_at: new Date(`${row.payment_due_date}T12:00:00`).toISOString(),
                        target: "#/accounting",
                    });
                });
            }

            // Tüm hareketleri çek; tedarikçi başına NET bakiye hesapla. Geciken bildirimi
            // yalnızca gerçekten KALAN borcu olan tedarikçi için, kalan tutarla üret —
            // ödenmiş vadeli borç yanlış "geciken ödeme" bildirimi oluşturmasın.
            const supplierRes = await supabase
                .from("supplier_transactions")
                .select("supplier_id,amount,due_date,transaction_type,suppliers(name)")
                .eq("company_id", ctx.company_id);

            if (!supplierRes.error) {
                const agg = new Map<string, { name: string; balance: number; earliestOverdue: string | null }>();
                for (const row of (supplierRes.data ?? []) as any[]) {
                    const sid = row.supplier_id;
                    if (!sid) continue;
                    const sup = Array.isArray(row.suppliers) ? row.suppliers[0] : row.suppliers;
                    const entry = agg.get(sid) ?? { name: sup?.name || "Tedarikçi", balance: 0, earliestOverdue: null };
                    const amt = Number(row.amount ?? 0);
                    if (row.transaction_type === "debt") entry.balance += amt;
                    else if (row.transaction_type === "payment" || row.transaction_type === "cancel") entry.balance -= amt;
                    if (row.transaction_type === "debt" && row.due_date && row.due_date <= today) {
                        if (!entry.earliestOverdue || row.due_date < entry.earliestOverdue) entry.earliestOverdue = row.due_date;
                    }
                    agg.set(sid, entry);
                }
                Array.from(agg.entries())
                    .filter(([, e]) => e.earliestOverdue && e.balance > 0.01)
                    .slice(0, 20)
                    .forEach(([sid, e]) => {
                        items.push({
                            id: `supplier-${sid}-${e.earliestOverdue}`,
                            title: "Geciken ödeme",
                            message: `${e.name} - ${new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(e.balance)}`,
                            type: "error",
                            created_at: new Date(`${e.earliestOverdue}T12:00:00`).toISOString(),
                            target: "#/suppliers",
                        });
                    });
            }

            const completedRes = await supabase
                .from("installation_jobs")
                .select("id,order_id,customer_name,completed_at,updated_at,status")
                .eq("company_id", ctx.company_id)
                .eq("status", "completed")
                .gte("updated_at", start.toISOString())
                .lte("updated_at", end.toISOString())
                .limit(10);

            if (!completedRes.error) {
                (completedRes.data ?? []).forEach((row: any) => {
                    items.push({
                        id: `completed-installation-${row.id}`,
                        title: "Tamamlanan montaj",
                        message: row.customer_name || "Montaj tamamlandı",
                        type: "success",
                        created_at: row.completed_at || row.updated_at || new Date().toISOString(),
                        target: `#/orders/${row.order_id}`,
                    });
                });
            }

            const supportRes = await supabase
                .from("support_tickets")
                .select("id,title,created_at,status")
                .neq("status", "closed")
                .order("created_at", { ascending: false })
                .limit(5);

            if (!supportRes.error) {
                (supportRes.data ?? []).forEach((row: any) => {
                    items.push({
                        id: `support-${row.id}`,
                        title: "Yeni destek talebi",
                        message: row.title || "Destek talebi",
                        type: "info",
                        created_at: row.created_at || new Date().toISOString(),
                        target: "#/super-admin/support",
                    });
                });
            }

            setOperational(items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 30));
        } catch {
            setOperational([]);
        }
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadNotifications();
            void loadOperationalNotifications();
        }, 0);

        // Subscribe to new notifications
        const channel = supabase
            .channel(`user-notifications-${userId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${userId}`
            }, () => {
                loadNotifications();
            })
            .subscribe();

        return () => {
            window.clearTimeout(timer);
            supabase.removeChannel(channel);
        };
    }, [loadNotifications, loadOperationalNotifications, userId]);

    async function markAsRead(id: string) {
        await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', id);
        
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    }

    async function markAllAsRead() {
        await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', userId)
            .eq('is_read', false);
        
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
        const allOperational = new Set(operational.map((item) => item.id));
        setReadOperational(allOperational);
        localStorage.setItem("dashboard_read_operational_notifications", JSON.stringify([...allOperational]));
    }

    function markOperationalAsRead(id: string) {
        setReadOperational((prev) => {
            const next = new Set(prev);
            next.add(id);
            localStorage.setItem("dashboard_read_operational_notifications", JSON.stringify([...next]));
            return next;
        });
    }

    const typeIcons = {
        info: <Info size={16} className="text-blue-500" />,
        success: <CheckCircle2 size={16} className="text-emerald-500" />,
        warning: <AlertTriangle size={16} className="text-amber-500" />,
        error: <X size={16} className="text-red-500" />,
        update: <RefreshCw size={16} className="text-purple-500" />
    };

    return (
        <div className="relative">
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 hover:bg-slate-100 transition-colors"
            >
                <Bell size={20} />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-white dark:border-slate-900 animate-in zoom-in duration-300">
                        {unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <>
                    <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute right-2 mt-3 w-screen sm:w-80 md:w-96 max-w-sm bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-2xl z-50 overflow-hidden animate-in slide-in-from-top-2 duration-200">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex justify-between items-center">
                            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                Bildirimler
                                {unreadCount > 0 && <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-black">{unreadCount} Yeni</span>}
                            </h3>
                            {unreadCount > 0 && (
                                <button 
                                    onClick={markAllAsRead}
                                    className="text-xs font-bold text-blue-600 hover:underline"
                                >
                                    Okundu olarak işaretle
                                </button>
                            )}
                        </div>

                        <div className="max-h-[400px] overflow-y-auto">
                            {notifications.length + visibleOperational.length > 0 ? (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {visibleOperational.map((n) => (
                                        <div
                                            key={n.id}
                                            onClick={() => {
                                                markOperationalAsRead(n.id);
                                                setIsOpen(false);
                                                window.location.hash = n.target;
                                            }}
                                            className="p-4 flex gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer relative bg-blue-50/30 dark:bg-blue-900/10"
                                        >
                                            <div className="shrink-0 mt-1">{typeIcons[n.type]}</div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                                    <h4 className="text-sm truncate font-black text-slate-900 dark:text-white">{n.title}</h4>
                                                    <Circle size={8} className="fill-blue-600 text-blue-600 shrink-0" />
                                                </div>
                                                <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{n.message}</p>
                                                <span className="text-[10px] text-slate-400 mt-2 block">
                                                    {format(new Date(n.created_at), 'dd MMM HH:mm', { locale: tr })}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                    {notifications.map((n) => (
                                        <div
                                            key={n.id}
                                            onClick={() => {
                                                markAsRead(n.id);
                                                // Destek bildirimi: kullanıcıyı Destek Taleplerim'e götür
                                                if (n.related_ticket_id) {
                                                    setIsOpen(false);
                                                    window.location.hash = "#/settings";
                                                }
                                            }}
                                            className={cn(
                                                "p-4 flex gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer relative",
                                                !n.is_read && "bg-blue-50/30 dark:bg-blue-900/10"
                                            )}
                                        >
                                            <div className="shrink-0 mt-1">
                                                {typeIcons[n.type]}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                                    <h4 className={cn("text-sm truncate", n.is_read ? "font-medium text-slate-700 dark:text-slate-300" : "font-black text-slate-900 dark:text-white")}>
                                                        {n.title}
                                                    </h4>
                                                    {!n.is_read && <Circle size={8} className="fill-blue-600 text-blue-600 shrink-0" />}
                                                </div>
                                                <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                                                    {n.message}
                                                </p>
                                                <span className="text-[10px] text-slate-400 mt-2 block">
                                                    {format(new Date(n.created_at), 'dd MMM HH:mm', { locale: tr })}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-12 text-center">
                                    <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-300 mx-auto mb-4">
                                        <Bell size={32} />
                                    </div>
                                    <h4 className="font-bold text-slate-900 dark:text-white">Bildirim Yok</h4>
                                    <p className="text-xs text-slate-500 mt-1">Şu an için yeni bir bildiriminiz bulunmuyor.</p>
                                </div>
                            )}
                        </div>

                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 text-center">
                            <button className="text-xs font-black text-slate-500 uppercase tracking-widest hover:text-slate-900">
                                Tüm Geçmişi Gör
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
